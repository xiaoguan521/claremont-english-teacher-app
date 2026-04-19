import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

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

type MembershipRow = {
  class_id: string | null
  role: string
}

type ClassOption = {
  id: string
  name: string
  school_id: string
}

type MaterialOption = {
  id: string
  title: string
  school_id: string
}

type AssignmentView = AssignmentRow & {
  submittedCount: number
  pendingCount: number
  submissionRate: number
}

export function AssignmentsPage() {
  const { memberships, session } = useAuth()
  const [rows, setRows] = useState<AssignmentView[]>([])
  const [classNames, setClassNames] = useState<Record<string, string>>({})
  const [classOptions, setClassOptions] = useState<ClassOption[]>([])
  const [materialOptions, setMaterialOptions] = useState<MaterialOption[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    classId: '',
    materialId: '',
    title: '',
    description: '',
    dueAt: '',
    status: 'draft',
    itemType: 'sentence',
    itemTitle: '',
    promptText: '',
    expectedText: '',
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
      if (schoolIds.length === 0) {
        setRows([])
        setClassOptions([])
        setMaterialOptions([])
        return
      }

      const assignmentQuery =
        canViewWholeSchool || classIds.length === 0
          ? supabase
              .from('assignments')
              .select('id, title, status, due_at, class_id')
              .in('school_id', schoolIds)
          : supabase
              .from('assignments')
              .select('id, title, status, due_at, class_id')
              .in('class_id', classIds)

      const classesQuery =
        canViewWholeSchool || classIds.length === 0
          ? supabase
              .from('classes')
              .select('id, name, school_id')
              .in('school_id', schoolIds)
              .eq('status', 'active')
              .order('name')
          : supabase.from('classes').select('id, name, school_id').in('id', classIds).order('name')

      const [assignmentsResponse, classesResponse, materialsResponse] = await Promise.all([
        assignmentQuery.order('created_at', { ascending: false }),
        classesQuery,
        supabase
          .from('materials')
          .select('id, title, school_id')
          .in('school_id', schoolIds)
          .neq('status', 'archived')
          .order('created_at', { ascending: false }),
      ])

      if (!assignmentsResponse.error) {
        const assignments = (assignmentsResponse.data ?? []) as AssignmentRow[]
        const assignmentIds = assignments.map((item) => item.id)
        const scopedClassIds = Array.from(new Set(assignments.map((item) => item.class_id)))

        const [submissionResponse, studentMembershipResponse] = await Promise.all([
          assignmentIds.length
            ? supabase
                .from('submissions')
                .select('assignment_id, status')
                .in('assignment_id', assignmentIds)
            : Promise.resolve({ data: [], error: null }),
          scopedClassIds.length
            ? supabase
                .from('memberships')
                .select('class_id, role')
                .in('class_id', scopedClassIds)
                .eq('role', 'student')
                .eq('status', 'active')
            : Promise.resolve({ data: [], error: null }),
        ])

        const submissionRows = (submissionResponse.data ?? []) as SubmissionRow[]
        const studentMemberships = (studentMembershipResponse.data ?? []) as MembershipRow[]

        const submittedCountByAssignment = new Map<string, number>()
        const pendingCountByAssignment = new Map<string, number>()
        submissionRows.forEach((item) => {
          if (item.status !== 'draft') {
            submittedCountByAssignment.set(
              item.assignment_id,
              (submittedCountByAssignment.get(item.assignment_id) ?? 0) + 1,
            )
          }
          if (item.status !== 'draft' && item.status !== 'completed') {
            pendingCountByAssignment.set(
              item.assignment_id,
              (pendingCountByAssignment.get(item.assignment_id) ?? 0) + 1,
            )
          }
        })

        const studentsByClass = new Map<string, number>()
        studentMemberships.forEach((item) => {
          if (!item.class_id) return
          studentsByClass.set(item.class_id, (studentsByClass.get(item.class_id) ?? 0) + 1)
        })

        setRows(
          assignments.map((assignment) => {
            const submittedCount = submittedCountByAssignment.get(assignment.id) ?? 0
            const expectedStudents = studentsByClass.get(assignment.class_id) ?? 0

            return {
              ...assignment,
              submittedCount,
              pendingCount: pendingCountByAssignment.get(assignment.id) ?? 0,
              submissionRate:
                expectedStudents > 0
                  ? Math.round((submittedCount / expectedStudents) * 100)
                  : 0,
            }
          }),
        )

        if (scopedClassIds.length) {
          const { data: classes } = await supabase.from('classes').select('id, name').in('id', scopedClassIds)
          setClassNames(
            Object.fromEntries(
              (classes ?? []).map((item) => [item.id as string, item.name as string]),
            ),
          )
        }
      }

      if (!classesResponse.error) {
        const nextClassOptions = (classesResponse.data ?? []) as ClassOption[]
        setClassOptions(nextClassOptions)
        if (nextClassOptions.length > 0 && !form.classId) {
          setForm((current) => ({ ...current, classId: nextClassOptions[0].id }))
        }
      }

      if (!materialsResponse.error) {
        setMaterialOptions((materialsResponse.data ?? []) as MaterialOption[])
      }
    }

    void load()
  }, [canViewWholeSchool, classIds, form.classId, schoolIds])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!session?.user || !form.classId) {
      setError('当前缺少登录会话或班级范围。')
      return
    }

    const targetClass = classOptions.find((item) => item.id === form.classId)
    if (!targetClass) {
      setError('未找到所选班级。')
      return
    }

    setSubmitting(true)
    setFeedback(null)
    setError(null)

    const dueAtIso = form.dueAt ? new Date(form.dueAt).toISOString() : null

    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .insert({
        school_id: targetClass.school_id,
        class_id: form.classId,
        material_id: form.materialId || null,
        title: form.title.trim(),
        description: form.description.trim() || null,
        due_at: dueAtIso,
        status: form.status,
        created_by: session.user.id,
      })
      .select('id, title, status, due_at, class_id')
      .single()

    if (assignmentError) {
      setSubmitting(false)
      setError(assignmentError.message)
      return
    }

    const { error: itemError } = await supabase.from('assignment_items').insert({
      assignment_id: assignment.id,
      sort_order: 1,
      item_type: form.itemType,
      title: form.itemTitle.trim() || null,
      prompt_text: form.promptText.trim(),
      expected_text: form.expectedText.trim() || null,
      tts_text: form.expectedText.trim() || null,
    })

    setSubmitting(false)

    if (itemError) {
      setError(itemError.message)
      return
    }

    setRows((current) => [
      {
        ...(assignment as AssignmentRow),
        submittedCount: 0,
        pendingCount: 0,
        submissionRate: 0,
      },
      ...current,
    ])
    setClassNames((current) => ({
      ...current,
      [targetClass.id]: targetClass.name,
    }))
    setFeedback('作业已经创建完成，下一步可以去提醒学生开始打卡。')
    setForm((current) => ({
      ...current,
      materialId: '',
      title: '',
      description: '',
      dueAt: '',
      status: 'draft',
      itemType: 'sentence',
      itemTitle: '',
      promptText: '',
      expectedText: '',
    }))
  }

  const currentMaterialOptions = form.classId
    ? materialOptions.filter(
        (item) =>
          item.school_id === classOptions.find((classItem) => classItem.id === form.classId)?.school_id,
      )
    : materialOptions

  return (
    <section className="page">
      <header className="page-header compact">
        <div>
          <span className="eyebrow">Assignments</span>
          <h1>作业中心</h1>
          <p>先布置作业，再盯提交率和待处理提交，老师最常用的两条链路都在这里。</p>
        </div>
      </header>

      <article className="panel">
        <div className="panel-heading">
          <h2>布置新作业</h2>
          <span className="status-pill active">创建后可继续提醒学生</span>
        </div>
        <p className="panel-copy">
          先创建作业主记录和第一条练习内容，足够覆盖老师最常用的布置流程。
        </p>

        <form className="inline-form" onSubmit={handleSubmit}>
          <label>
            班级
            <select
              value={form.classId}
              onChange={(event) =>
                setForm((current) => ({ ...current, classId: event.target.value }))
              }
              required
            >
              {classOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            关联教材
            <select
              value={form.materialId}
              onChange={(event) =>
                setForm((current) => ({ ...current, materialId: event.target.value }))
              }
            >
              <option value="">暂不关联教材</option>
              {currentMaterialOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>

          <label className="span-2">
            作业标题
            <input
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="例如：Day 1 朗读打卡"
              required
            />
          </label>

          <label className="span-2">
            作业说明
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="告诉学生今天要做什么、怎么提交。"
            />
          </label>

          <label>
            截止时间
            <input
              type="datetime-local"
              value={form.dueAt}
              onChange={(event) =>
                setForm((current) => ({ ...current, dueAt: event.target.value }))
              }
            />
          </label>

          <label>
            状态
            <select
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({ ...current, status: event.target.value }))
              }
            >
              <option value="draft">草稿</option>
              <option value="published">已发布</option>
              <option value="closed">已截止</option>
              <option value="archived">已归档</option>
            </select>
          </label>

          <label>
            练习类型
            <select
              value={form.itemType}
              onChange={(event) =>
                setForm((current) => ({ ...current, itemType: event.target.value }))
              }
            >
              <option value="word">单词</option>
              <option value="sentence">句子</option>
              <option value="paragraph">段落</option>
            </select>
          </label>

          <label>
            练习标题
            <input
              value={form.itemTitle}
              onChange={(event) =>
                setForm((current) => ({ ...current, itemTitle: event.target.value }))
              }
              placeholder="例如：跟读句子 1"
            />
          </label>

          <label className="span-2">
            提示内容
            <textarea
              rows={3}
              value={form.promptText}
              onChange={(event) =>
                setForm((current) => ({ ...current, promptText: event.target.value }))
              }
              placeholder="例如：请大声朗读下面这句话。"
              required
            />
          </label>

          <label className="span-2">
            目标文本
            <textarea
              rows={3}
              value={form.expectedText}
              onChange={(event) =>
                setForm((current) => ({ ...current, expectedText: event.target.value }))
              }
              placeholder="例如：I can read this story aloud."
            />
          </label>

          {error ? <div className="error-banner span-2">{error}</div> : null}
          {feedback ? <div className="success-banner span-2">{feedback}</div> : null}

          <div className="form-actions span-2">
            <button className="primary-button" disabled={submitting} type="submit">
              {submitting ? '创建中...' : '创建作业'}
            </button>
          </div>
        </form>
      </article>

      {rows.length === 0 ? (
        <div className="empty-state">当前还没有作业数据。</div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>作业标题</th>
                <th>班级</th>
                <th>状态</th>
                <th>提交率</th>
                <th>待处理</th>
                <th>截止时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.title}</td>
                  <td>{classNames[row.class_id] || row.class_id}</td>
                  <td>{mapAssignmentStatus(row.status)}</td>
                  <td>{row.status === 'draft' ? '-' : `${row.submissionRate}%`}</td>
                  <td>{row.pendingCount > 0 ? `${row.pendingCount} 份` : '无'}</td>
                  <td>{row.due_at ? new Date(row.due_at).toLocaleString() : '未设置'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function mapAssignmentStatus(status: string) {
  if (status === 'published') return '已发布'
  if (status === 'closed') return '已截止'
  if (status === 'archived') return '已归档'
  return '草稿'
}
