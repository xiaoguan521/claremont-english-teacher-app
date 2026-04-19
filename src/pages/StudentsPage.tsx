import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type StudentMembership = {
  user_id: string
  class_id: string | null
}

type StudentProfile = {
  id: string
  display_name: string | null
  phone: string | null
}

type ClassRow = {
  id: string
  name: string
}

type AssignmentRow = {
  id: string
  class_id: string
}

type SubmissionRow = {
  student_id: string
  assignment_id: string
  status: string
  latest_feedback: string | null
  updated_at: string
}

type StudentProgressRow = {
  id: string
  name: string
  phone: string
  className: string
  submittedCount: number
  pendingCount: number
  latestFeedback: string
}

export function StudentsPage() {
  const { memberships } = useAuth()
  const [rows, setRows] = useState<StudentProgressRow[]>([])

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
      const studentQuery =
        canViewWholeSchool || classIds.length === 0
          ? supabase
              .from('memberships')
              .select('user_id, class_id')
              .in('school_id', schoolIds)
              .eq('role', 'student')
              .eq('status', 'active')
          : supabase
              .from('memberships')
              .select('user_id, class_id')
              .in('class_id', classIds)
              .eq('role', 'student')
              .eq('status', 'active')

      const { data: studentMemberships, error } = await studentQuery

      if (error || !studentMemberships?.length) {
        setRows([])
        return
      }

      const membershipsRows = studentMemberships as StudentMembership[]
      const userIds = Array.from(new Set(membershipsRows.map((item) => item.user_id)))
      const scopedClassIds = Array.from(
        new Set(membershipsRows.map((item) => item.class_id).filter(Boolean) as string[]),
      )

      const [profilesResponse, classesResponse, assignmentsResponse] = await Promise.all([
        supabase.from('profiles').select('id, display_name, phone').in('id', userIds),
        scopedClassIds.length
          ? supabase.from('classes').select('id, name').in('id', scopedClassIds)
          : Promise.resolve({ data: [], error: null }),
        scopedClassIds.length
          ? supabase.from('assignments').select('id, class_id').in('class_id', scopedClassIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      if (profilesResponse.error || classesResponse.error || assignmentsResponse.error) {
        setRows([])
        return
      }

      const assignments = (assignmentsResponse.data ?? []) as AssignmentRow[]
      const assignmentIds = assignments.map((item) => item.id)
      const { data: submissionsData, error: submissionsError } = assignmentIds.length
        ? await supabase
            .from('submissions')
            .select('student_id, assignment_id, status, latest_feedback, updated_at')
            .in('assignment_id', assignmentIds)
        : { data: [], error: null }

      if (submissionsError) {
        setRows([])
        return
      }

      const profileMap = new Map<string, StudentProfile>(
        ((profilesResponse.data ?? []) as StudentProfile[]).map((item) => [item.id, item]),
      )
      const classMap = new Map<string, string>(
        ((classesResponse.data ?? []) as ClassRow[]).map((item) => [item.id, item.name]),
      )

      const submissions = (submissionsData ?? []) as SubmissionRow[]
      const studentStats = new Map<
        string,
        { submittedCount: number; pendingCount: number; latestFeedback: string; latestUpdatedAt: string | null }
      >()

      submissions.forEach((item) => {
        const current = studentStats.get(item.student_id) ?? {
          submittedCount: 0,
          pendingCount: 0,
          latestFeedback: '',
          latestUpdatedAt: null,
        }

        if (item.status !== 'draft') {
          current.submittedCount += 1
        }

        if (item.status !== 'draft' && item.status !== 'completed') {
          current.pendingCount += 1
        }

        if (
          item.latest_feedback &&
          (!current.latestUpdatedAt ||
            new Date(item.updated_at).getTime() > new Date(current.latestUpdatedAt).getTime())
        ) {
          current.latestFeedback = item.latest_feedback
          current.latestUpdatedAt = item.updated_at
        }

        studentStats.set(item.student_id, current)
      })

      setRows(
        membershipsRows.map((item) => {
          const profile = profileMap.get(item.user_id)
          const stats = studentStats.get(item.user_id)

          return {
            id: `${item.user_id}-${item.class_id ?? 'none'}`,
            name: profile?.display_name ?? item.user_id,
            phone: profile?.phone ?? '-',
            className: item.class_id ? classMap.get(item.class_id) ?? item.class_id : '未分班',
            submittedCount: stats?.submittedCount ?? 0,
            pendingCount: stats?.pendingCount ?? 0,
            latestFeedback: stats?.latestFeedback || '还没有新的老师反馈',
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
          <span className="eyebrow">Students</span>
          <h1>学员进度</h1>
          <p>先看每个学生最近有没有提交、有没有待处理任务，再决定今天先盯谁。</p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="empty-state">当前还没有学员数据。</div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>电话</th>
                <th>班级</th>
                <th>已提交</th>
                <th>待处理</th>
                <th>最近反馈</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.phone}</td>
                  <td>{row.className}</td>
                  <td>{row.submittedCount}</td>
                  <td>{row.pendingCount > 0 ? `${row.pendingCount} 份` : '无'}</td>
                  <td className="feedback-cell">{row.latestFeedback}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
