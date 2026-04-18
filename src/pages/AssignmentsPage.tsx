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

export function AssignmentsPage() {
  const { memberships, session } = useAuth()
  const [rows, setRows] = useState<AssignmentRow[]>([])
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
          : supabase
              .from('classes')
              .select('id, name, school_id')
              .in('id', classIds)
              .order('name')

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
        setRows(assignments)

        const scopedClassIds = Array.from(new Set(assignments.map((item) => item.class_id)))
        if (scopedClassIds.length) {
          const { data: classes } = await supabase
            .from('classes')
            .select('id, name')
            .in('id', scopedClassIds)
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

    setRows((current) => [assignment as AssignmentRow, ...current])
    setClassNames((current) => ({
      ...current,
      [targetClass.id]: targetClass.name,
    }))
    setFeedback('作业和首条练习内容已经创建。')
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
        </div>
      </header>

      <article className="panel">
        <h2>布置新作业</h2>
        <p className="panel-copy">
          今天先把作业主记录和第一条练习项接起来，足够演示教师端最常用的布置流程。
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
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="closed">closed</option>
              <option value="archived">archived</option>
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
              <option value="word">word</option>
              <option value="sentence">sentence</option>
              <option value="paragraph">paragraph</option>
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
              {submitting ? '发布中...' : '创建作业'}
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
                <th>截止时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.title}</td>
                  <td>{classNames[row.class_id] || row.class_id}</td>
                  <td>{row.status}</td>
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
