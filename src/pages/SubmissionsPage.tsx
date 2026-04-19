import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type AssignmentRow = {
  id: string
  title: string
  class_id: string
}

type SubmissionRow = {
  id: string
  student_id: string
  assignment_id: string
  status: string
  submitted_at: string | null
  latest_score: number | null
  latest_feedback: string | null
}

type ProfileRow = {
  id: string
  display_name: string | null
}

type ClassRow = {
  id: string
  name: string
}

type SubmissionQueueRow = {
  id: string
  studentName: string
  className: string
  assignmentTitle: string
  statusLabel: string
  submittedAt: string
  latestScore: string
  latestFeedback: string
}

type QueueSummary = {
  pending: number
  processing: number
  completed: number
}

export function SubmissionsPage() {
  const { memberships } = useAuth()
  const [rows, setRows] = useState<SubmissionQueueRow[]>([])
  const [summary, setSummary] = useState<QueueSummary>({
    pending: 0,
    processing: 0,
    completed: 0,
  })

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
      const assignmentQuery =
        canViewWholeSchool || classIds.length === 0
          ? supabase
              .from('assignments')
              .select('id, title, class_id')
              .in('school_id', schoolIds)
          : supabase
              .from('assignments')
              .select('id, title, class_id')
              .in('class_id', classIds)

      const { data: assignmentsData, error: assignmentsError } = await assignmentQuery

      if (assignmentsError || !assignmentsData?.length) {
        setRows([])
        setSummary({ pending: 0, processing: 0, completed: 0 })
        return
      }

      const assignments = assignmentsData as AssignmentRow[]
      const assignmentIds = assignments.map((item) => item.id)
      const classIdList = Array.from(new Set(assignments.map((item) => item.class_id)))

      const [submissionsResponse, profilesResponse, classesResponse] = await Promise.all([
        supabase
          .from('submissions')
          .select(
            'id, student_id, assignment_id, status, submitted_at, latest_score, latest_feedback',
          )
          .in('assignment_id', assignmentIds)
          .neq('status', 'draft')
          .order('updated_at', { ascending: false }),
        supabase.from('profiles').select('id, display_name'),
        classIdList.length
          ? supabase.from('classes').select('id, name').in('id', classIdList)
          : Promise.resolve({ data: [], error: null }),
      ])

      if (submissionsResponse.error || profilesResponse.error || classesResponse.error) {
        setRows([])
        setSummary({ pending: 0, processing: 0, completed: 0 })
        return
      }

      const submissions = (submissionsResponse.data ?? []) as SubmissionRow[]
      const assignmentMap = new Map(assignments.map((item) => [item.id, item]))
      const classMap = new Map(
        ((classesResponse.data ?? []) as ClassRow[]).map((item) => [item.id, item.name]),
      )
      const profileMap = new Map(
        ((profilesResponse.data ?? []) as ProfileRow[]).map((item) => [item.id, item.display_name ?? item.id]),
      )

      let pending = 0
      let processing = 0
      let completed = 0

      const mappedRows = submissions.map((item) => {
        if (item.status === 'uploaded' || item.status === 'queued') pending += 1
        else if (item.status === 'processing') processing += 1
        else if (item.status === 'completed') completed += 1

        const assignment = assignmentMap.get(item.assignment_id)
        const className = assignment?.class_id ? classMap.get(assignment.class_id) ?? assignment.class_id : '未分班'

        return {
          id: item.id,
          studentName: profileMap.get(item.student_id) ?? item.student_id,
          className,
          assignmentTitle: assignment?.title ?? item.assignment_id,
          statusLabel: mapSubmissionStatus(item.status),
          submittedAt: item.submitted_at
            ? new Date(item.submitted_at).toLocaleString()
            : '尚未提交时间',
          latestScore: item.latest_score != null ? `${item.latest_score}` : '-',
          latestFeedback: item.latest_feedback || '等待老师点评或系统评分',
        }
      })

      setRows(mappedRows)
      setSummary({ pending, processing, completed })
    }

    void load()
  }, [canViewWholeSchool, classIds, memberships, schoolIds])

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Queue</span>
          <h1>点评队列</h1>
          <p>集中查看刚提交、正在评分和已经完成的记录，老师可以先从待处理任务开始。</p>
        </div>
      </header>

      <div className="stat-grid teacher-dashboard-grid">
        <QueueStatCard title="待查看" value={String(summary.pending)} note="刚提交或排队中的记录" />
        <QueueStatCard title="处理中" value={String(summary.processing)} note="正在走评分或点评链路" />
        <QueueStatCard title="已完成" value={String(summary.completed)} note="已经产生分数或反馈的记录" />
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">当前还没有可见提交记录。</div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>学员</th>
                <th>班级</th>
                <th>作业</th>
                <th>状态</th>
                <th>提交时间</th>
                <th>分数</th>
                <th>反馈</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.studentName}</td>
                  <td>{row.className}</td>
                  <td>{row.assignmentTitle}</td>
                  <td>{row.statusLabel}</td>
                  <td>{row.submittedAt}</td>
                  <td>{row.latestScore}</td>
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

function mapSubmissionStatus(status: string) {
  if (status === 'uploaded' || status === 'queued') return '待查看'
  if (status === 'processing') return '处理中'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  return status
}

function QueueStatCard({
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
