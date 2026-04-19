import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type ClassRow = {
  id: string
  name: string
  grade_label: string | null
  academic_year: string | null
  status: string
}

type MembershipRow = {
  class_id: string | null
  role: string
}

type AssignmentRow = {
  id: string
  class_id: string
}

type SubmissionRow = {
  assignment_id: string
  status: string
}

type ClassView = ClassRow & {
  teacherCount: number
  studentCount: number
  assignmentCount: number
  submissionRate: number
  pendingCount: number
}

export function ClassesPage() {
  const { memberships } = useAuth()
  const [rows, setRows] = useState<ClassView[]>([])

  const schoolIds = useMemo(
    () => Array.from(new Set(memberships.map((item) => item.school_id))),
    [memberships],
  )

  const classIds = useMemo(
    () =>
      Array.from(
        new Set(memberships.map((item) => item.class_id).filter(Boolean) as string[]),
      ),
    [memberships],
  )

  const canViewWholeSchool = memberships.some(
    (item) => item.role === 'school_admin' && item.class_id === null,
  )

  useEffect(() => {
    const load = async () => {
      if (schoolIds.length === 0) {
        setRows([])
        return
      }

      const query =
        canViewWholeSchool || classIds.length === 0
          ? supabase
              .from('classes')
              .select('id, name, grade_label, academic_year, status')
              .in('school_id', schoolIds)
          : supabase
              .from('classes')
              .select('id, name, grade_label, academic_year, status')
              .in('id', classIds)

      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) return

      const classes = (data ?? []) as ClassRow[]
      const scopedClassIds = classes.map((item) => item.id)
      if (scopedClassIds.length === 0) {
        setRows([])
        return
      }

      const [membershipsResponse, assignmentsResponse] = await Promise.all([
        supabase
          .from('memberships')
          .select('class_id, role')
          .in('class_id', scopedClassIds)
          .in('role', ['teacher', 'student'])
          .eq('status', 'active'),
        supabase.from('assignments').select('id, class_id').in('class_id', scopedClassIds),
      ])

      if (membershipsResponse.error || assignmentsResponse.error) return

      const assignments = (assignmentsResponse.data ?? []) as AssignmentRow[]
      const assignmentIds = assignments.map((item) => item.id)
      const { data: submissionsData, error: submissionsError } = assignmentIds.length
        ? await supabase
            .from('submissions')
            .select('assignment_id, status')
            .in('assignment_id', assignmentIds)
        : { data: [], error: null }

      if (submissionsError) return

      const membershipsRows = (membershipsResponse.data ?? []) as MembershipRow[]
      const submissions = (submissionsData ?? []) as SubmissionRow[]

      const counters = new Map<
        string,
        { teacherCount: number; studentCount: number; assignmentCount: number }
      >()

      membershipsRows.forEach((item) => {
        if (!item.class_id) return
        const current = counters.get(item.class_id) ?? {
          teacherCount: 0,
          studentCount: 0,
          assignmentCount: 0,
        }

        if (item.role === 'teacher') current.teacherCount += 1
        if (item.role === 'student') current.studentCount += 1
        counters.set(item.class_id, current)
      })

      const assignmentClassMap = new Map(assignments.map((item) => [item.id, item.class_id]))
      const submittedByClass = new Map<string, number>()
      const pendingByClass = new Map<string, number>()

      assignments.forEach((item) => {
        const current = counters.get(item.class_id) ?? {
          teacherCount: 0,
          studentCount: 0,
          assignmentCount: 0,
        }
        current.assignmentCount += 1
        counters.set(item.class_id, current)
      })

      submissions.forEach((item) => {
        const classId = assignmentClassMap.get(item.assignment_id)
        if (!classId || item.status === 'draft') return

        submittedByClass.set(classId, (submittedByClass.get(classId) ?? 0) + 1)
        if (item.status !== 'completed') {
          pendingByClass.set(classId, (pendingByClass.get(classId) ?? 0) + 1)
        }
      })

      setRows(
        classes.map((item) => {
          const current = counters.get(item.id) ?? {
            teacherCount: 0,
            studentCount: 0,
            assignmentCount: 0,
          }
          const expectedSubmissions = current.studentCount * current.assignmentCount
          const actualSubmissions = submittedByClass.get(item.id) ?? 0

          return {
            ...item,
            teacherCount: current.teacherCount,
            studentCount: current.studentCount,
            assignmentCount: current.assignmentCount,
            submissionRate:
              expectedSubmissions > 0
                ? Math.round((actualSubmissions / expectedSubmissions) * 100)
                : 0,
            pendingCount: pendingByClass.get(item.id) ?? 0,
          }
        }),
      )
    }

    void load()
  }, [canViewWholeSchool, classIds, memberships, schoolIds])

  return (
    <section className="page">
      <header className="page-header compact">
        <div>
          <span className="eyebrow">Classes</span>
          <h1>班级概览</h1>
          <p>先看每个班的学生数、作业量和待处理提交，再决定今天优先跟进哪个班。</p>
        </div>
      </header>
      <DataTable
        columns={['班级', '年级', '教师', '学员', '作业数', '提交率', '待处理']}
        rows={rows.map((row) => [
          row.name,
          row.grade_label || row.academic_year || '-',
          String(row.teacherCount),
          String(row.studentCount),
          String(row.assignmentCount),
          row.assignmentCount > 0 ? `${row.submissionRate}%` : '-',
          row.pendingCount > 0 ? `${row.pendingCount} 份` : '无',
        ])}
        emptyMessage="当前账号下还没有可见班级。"
      />
    </section>
  )
}

function DataTable({
  columns,
  rows,
  emptyMessage,
}: {
  columns: string[]
  rows: string[][]
  emptyMessage: string
}) {
  if (rows.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>
  }

  return (
    <div className="table-card">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join('-')}>
              {row.map((value) => (
                <td key={value}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
