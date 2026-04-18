import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type MaterialRow = {
  id: string
  school_id: string
  title: string
  status: string
  pdf_path: string
}

export function MaterialsPage() {
  const { memberships, session } = useAuth()
  const [rows, setRows] = useState<MaterialRow[]>([])
  const [schoolNames, setSchoolNames] = useState<Record<string, string>>({})
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    schoolId: '',
    title: '',
    description: '',
    pdfPath: '',
    pageCount: '',
    status: 'draft',
  })

  const schoolIds = useMemo(
    () => Array.from(new Set(memberships.map((item) => item.school_id))),
    [memberships],
  )

  useEffect(() => {
    const load = async () => {
      if (schoolIds.length === 0) {
        setRows([])
        setSchoolNames({})
        return
      }

      const [materialsResponse, schoolsResponse] = await Promise.all([
        supabase
          .from('materials')
          .select('id, school_id, title, status, pdf_path')
          .in('school_id', schoolIds)
          .order('created_at', { ascending: false }),
        supabase.from('schools').select('id, name').in('id', schoolIds),
      ])

      if (!materialsResponse.error) {
        setRows((materialsResponse.data ?? []) as MaterialRow[])
      }

      if (!schoolsResponse.error) {
        setSchoolNames(
          Object.fromEntries(
            (schoolsResponse.data ?? []).map((item) => [
              item.id as string,
              item.name as string,
            ]),
          ),
        )
      }
    }

    void load()
  }, [schoolIds])

  useEffect(() => {
    if (schoolIds.length > 0 && !form.schoolId) {
      setForm((current) => ({ ...current, schoolId: schoolIds[0] }))
    }
  }, [form.schoolId, schoolIds])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!session?.user || !form.schoolId) {
      setError('当前缺少可用的学校范围或登录会话。')
      return
    }

    setSubmitting(true)
    setFeedback(null)
    setError(null)

    let resolvedPdfPath = form.pdfPath.trim()

    if (selectedFile) {
      const safeName = selectedFile.name.replace(/\s+/g, '-')
      const objectPath = `${form.schoolId}/${Date.now()}-${safeName}`
      const { error: uploadError } = await supabase.storage
        .from('materials')
        .upload(objectPath, selectedFile, {
          cacheControl: '3600',
          contentType: selectedFile.type || 'application/pdf',
          upsert: false,
        })

      if (uploadError) {
        setSubmitting(false)
        setError(uploadError.message)
        return
      }

      resolvedPdfPath = objectPath
    }

    if (!resolvedPdfPath) {
      setSubmitting(false)
      setError('请上传 PDF 文件，或手动填写已存在的存储路径。')
      return
    }

    const { data, error: insertError } = await supabase
      .from('materials')
      .insert({
        school_id: form.schoolId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        pdf_path: resolvedPdfPath,
        page_count: form.pageCount ? Number(form.pageCount) : null,
        status: form.status,
        uploaded_by: session.user.id,
      })
      .select('id, school_id, title, status, pdf_path')
      .single()

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setRows((current) => [data as MaterialRow, ...current])
    setFeedback('教材记录已创建。后续我们再把真实文件上传接进来。')
    setSelectedFile(null)
    setForm((current) => ({
      ...current,
      title: '',
      description: '',
      pdfPath: '',
      pageCount: '',
      status: 'draft',
    }))
  }

  return (
    <section className="page">
      <header className="page-header compact">
        <div>
          <span className="eyebrow">Materials</span>
          <h1>教材资源</h1>
        </div>
      </header>

      <article className="panel">
        <h2>新增教材记录</h2>
        <p className="panel-copy">
          今天先把教材元数据录入跑通，文件上传路径先手动填写 Supabase Storage 路径。
        </p>

        <form className="inline-form" onSubmit={handleSubmit}>
          <label>
            所属校区
            <select
              value={form.schoolId}
              onChange={(event) =>
                setForm((current) => ({ ...current, schoolId: event.target.value }))
              }
              required
            >
              {schoolIds.map((schoolId) => (
                <option key={schoolId} value={schoolId}>
                  {schoolNames[schoolId] ?? schoolId}
                </option>
              ))}
            </select>
          </label>

          <label>
            教材标题
            <input
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="例如：7天绘本朗读营"
              required
            />
          </label>

          <label className="span-2">
            上传 PDF
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
          </label>

          <label className="span-2">
            存储路径
            <input
              value={form.pdfPath}
              onChange={(event) =>
                setForm((current) => ({ ...current, pdfPath: event.target.value }))
              }
              placeholder="如不上传文件，可手动填写已有对象路径"
            />
          </label>

          <label className="span-2">
            教材说明
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="写一下这份教材适合哪个阶段、怎么使用。"
            />
          </label>

          <label>
            页数
            <input
              type="number"
              min="1"
              value={form.pageCount}
              onChange={(event) =>
                setForm((current) => ({ ...current, pageCount: event.target.value }))
              }
              placeholder="12"
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
              <option value="archived">archived</option>
            </select>
          </label>

          {error ? <div className="error-banner span-2">{error}</div> : null}
          {feedback ? <div className="success-banner span-2">{feedback}</div> : null}

          <div className="form-actions span-2">
            <button className="primary-button" disabled={submitting} type="submit">
              {submitting ? '保存中...' : '新增教材'}
            </button>
          </div>
        </form>
      </article>

      {rows.length === 0 ? (
        <div className="empty-state">当前还没有教材资源。</div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>教材标题</th>
                <th>校区</th>
                <th>状态</th>
                <th>存储路径</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.title}</td>
                  <td>{schoolNames[row.school_id] || row.school_id}</td>
                  <td>{row.status}</td>
                  <td>{row.pdf_path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
