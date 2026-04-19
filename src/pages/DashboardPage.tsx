import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type Summary = {
  classes: number
  students: number
  assignments: number
  materials: number
  pendingReview: number
  dueSoon: number
  missingSubmissions: number
}

type RecentAssignment = {
  id: string
  title: string
  className: string
  dueLabel: string
  statusLabel: string
  submissionRate: number
}

type AssignmentRow = {
  id: string
  title: string
  status: string
  due_at: string | null
  class_id: string
}

type SubmissionRow = {
  assignment_id: string
  status: string
}

type ClassRow = {
  id: string
  name: string
}

type MembershipRow = {
  class_id: string | null
  role: string
}

export function DashboardPage() {
  const { memberships } = useAuth()
  const [summary, setSummary] = useState<Summary>({
    classes: 0,
    students: 0,
    assignments: 0,
    materials: 0,
    pendingReview: 0,
    dueSoon: 0,
    missingSubmissions: 0,
  })
  const [recentAssignments, setRecentAssignments] = useState<RecentAssignment[]>([])
  const [loading, setLoading] = useState(true)

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
      setLoading(true)

      if (schoolIds.length === 0) {
        setSummary({
          classes: 0,
          students: 0,
          assignments: 0,
          materials: 0,
          pendingReview: 0,
          dueSoon: 0,
          missingSubmissions: 0,
        })
        setRecentAssignments([])
        setLoading(false)
        return
      }

      const classesScope =
        canViewWholeSchool || classIds.length === 0
          ? supabase
              .from('classes')
              .select('id, name')
              .in('school_id', schoolIds)
              .eq('status', 'active')
          : supabase
              .from('classes')
              .select('id, name')
              .in('id', classIds)
              .eq('status', 'active')

      const assignmentsScope =
        canViewWholeSchool || classIds.length === 0
          ? supabase
              .from('assignments')
              .select('id, title, status, due_at, class_id')
              .in('school_id', schoolIds)
          : supabase
              .from('assignments')
              .select('id, title, status, due_at, class_id')
              .in('class_id', classIds)

      const [classesResponse, assignmentsResponse, materialsResponse, studentsResponse] =
        await Promise.all([
          classesScope,
          assignmentsScope.order('created_at', { ascending: false }),
          supabase.from('materials').select('id', { count: 'exact' }).in('school_id', schoolIds),
          (canViewWholeSchool || classIds.length === 0
            ? supabase
                .from('memberships')
                .select('class_id, role')
                .in('school_id', schoolIds)
                .eq('role', 'student')
                .eq('status', 'active')
            : supabase
                .from('memberships')
                .select('class_id, role')
                .in('class_id', classIds)
                .eq('role', 'student')
                .eq('status', 'active')) as PromiseLike<{
            data: MembershipRow[] | null
            error: Error | null
          }>,
        ])

      if (
        classesResponse.error ||
        assignmentsResponse.error ||
        materialsResponse.error ||
        studentsResponse.error
      ) {
        setLoading(false)
        return
      }

      const classes = (classesResponse.data ?? []) as ClassRow[]
      const assignments = (assignmentsResponse.data ?? []) as AssignmentRow[]
      const studentMemberships = (studentsResponse.data ?? []) as MembershipRow[]

      const assignmentIds = assignments.map((item) => item.id)
      const { data: submissionsData, error: submissionsError } = assignmentIds.length
        ? await supabase
            .from('submissions')
            .select('assignment_id, status')
            .in('assignment_id', assignmentIds)
        : { data: [], error: null }

      if (submissionsError) {
        setLoading(false)
        return
      }

      const submissions = (submissionsData ?? []) as SubmissionRow[]
      const classMap = new Map(classes.map((item) => [item.id, item.name]))
      const studentsByClass = new Map<string, number>()
      for (const membership of studentMemberships) {
        if (!membership.class_id) continue
        studentsByClass.set(
          membership.class_id,
          (studentsByClass.get(membership.class_id) ?? 0) + 1,
        )
      }

      const submittedCountByAssignment = new Map<string, number>()
      const pendingCountByAssignment = new Map<string, number>()
      for (const submission of submissions) {
        if (submission.status !== 'draft') {
          submittedCountByAssignment.set(
            submission.assignment_id,
            (submittedCountByAssignment.get(submission.assignment_id) ?? 0) + 1,
          )
        }

        if (submission.status !== 'draft' && submission.status !== 'completed') {
          pendingCountByAssignment.set(
            submission.assignment_id,
            (pendingCountByAssignment.get(submission.assignment_id) ?? 0) + 1,
          )
        }
      }

      const now = new Date()
      const endOfTomorrow = new Date(now)
      endOfTomorrow.setHours(23, 59, 59, 999)
      endOfTomorrow.setDate(now.getDate() + 1)

      let missingSubmissions = 0
      let dueSoon = 0
      let pendingReview = 0

      const nextAssignments = assignments.slice(0, 5).map((assignment) => {
        const expectedStudents = studentsByClass.get(assignment.class_id) ?? 0
        const submittedCount = submittedCountByAssignment.get(assignment.id) ?? 0
        const pendingCount = pendingCountByAssignment.get(assignment.id) ?? 0
        const dueAt = assignment.due_at ? new Date(assignment.due_at) : null

        missingSubmissions += Math.max(expectedStudents - submittedCount, 0)
        pendingReview += pendingCount

        if (dueAt && dueAt <= endOfTomorrow && assignment.status === 'published') {
          dueSoon += 1
        }

        return {
          id: assignment.id,
          title: assignment.title,
          className: classMap.get(assignment.class_id) ?? assignment.class_id,
          dueLabel: dueAt ? dueAt.toLocaleString() : '未设置截止时间',
          statusLabel: mapAssignmentStatus(assignment.status),
          submissionRate:
            expectedStudents > 0 ? Math.round((submittedCount / expectedStudents) * 100) : 0,
        }
      })

      setSummary({
        classes: classes.length,
        students: studentMemberships.length,
        assignments: assignments.length,
        materials: materialsResponse.count ?? 0,
        pendingReview,
        dueSoon,
        missingSubmissions,
      })
      setRecentAssignments(nextAssignments)
      setLoading(false)
    }

    void load()
  }, [canViewWholeSchool, classIds, memberships, schoolIds])

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Today</span>
          <h1>教师待办中心</h1>
          <p>先看哪些作业最需要你处理，再决定今天先布置还是先回点评。</p>
        </div>
      </header>

      <div className="stat-grid teacher-dashboard-grid">
        <StatCard
          title="待处理提交"
          value={loading ? '...' : String(summary.pendingReview)}
          note="已经上传，正在等你查看或等待系统评分"
        />
        <StatCard
          title="即将到期"
          value={loading ? '...' : String(summary.dueSoon)}
          note="今天和明天到期的已发布作业"
        />
        <StatCard
          title="未交人数"
          value={loading ? '...' : String(summary.missingSubmissions)}
          note="基于班级人数和已提交作业自动估算"
        />
        <StatCard
          title="教材库存"
          value={loading ? '...' : String(summary.materials)}
          note="已入库，可用于继续布置新作业"
        />
      </div>

      <div className="content-grid teacher-workbench-grid">
        <article className="panel">
          <div className="panel-heading">
            <h2>今天先做什么</h2>
            <Link className="quick-link" to="/assignments">
              去作业中心
            </Link>
          </div>
          <div className="action-list">
            <ActionItem
              title="先处理待完成的点评"
              subtitle={`当前有 ${loading ? '...' : summary.pendingReview} 份提交还没走完反馈链路。`}
              tone="active"
            />
            <ActionItem
              title="关注即将到期的班级任务"
              subtitle={`已有 ${loading ? '...' : summary.dueSoon} 份作业将在明后天到期。`}
              tone="draft"
            />
            <ActionItem
              title="补齐未交学生提醒"
              subtitle={`按当前数据估算，还有 ${loading ? '...' : summary.missingSubmissions} 人次未提交。`}
            />
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>最近发布的作业</h2>
            <Link className="quick-link" to="/materials">
              去教材资源
            </Link>
          </div>
          {recentAssignments.length === 0 ? (
            <div className="empty-inline">当前还没有可见作业。</div>
          ) : (
            <ul className="info-list">
              {recentAssignments.map((item) => (
                <li key={item.id}>
                  <div className="info-meta">
                    <strong>{item.title}</strong>
                    <span>
                      {item.className} · {item.dueLabel}
                    </span>
                    <span>提交率 {item.submissionRate}%</span>
                  </div>
                  <span className="status-pill active">{item.statusLabel}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  )
}

function mapAssignmentStatus(status: string) {
  if (status === 'published') return '已发布'
  if (status === 'closed') return '已截止'
  if (status === 'archived') return '已归档'
  return '草稿'
}

function StatCard({
  title,
  value,
  note,
}: {
  title: string
  value: string
  note: string
}) {
  return (
    <article className="stat-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}

function ActionItem({
  title,
  subtitle,
  tone,
}: {
  title: string
  subtitle: string
  tone?: 'active' | 'draft'
}) {
  return (
    <div className="action-item">
      <div className="info-meta">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <span className={`status-pill ${tone ?? ''}`.trim()}>{tone === 'draft' ? '优先' : '处理中'}</span>
    </div>
  )
}
