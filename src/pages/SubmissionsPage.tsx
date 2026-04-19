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

type EvaluationResultRow = {
  submission_id: string
  encouragement: string | null
  strengths: unknown
  improvement_points: unknown
}

type SubmissionAssetRow = {
  submission_id: string
  storage_path: string
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
  status: string
  statusLabel: string
  submittedAt: string
  latestScore: string
  latestScoreValue: number | null
  latestFeedback: string
  latestFeedbackValue: string
  encouragement: string
  strengths: string[]
  improvementPoints: string[]
  audioFileName: string | null
  audioStoragePath: string | null
}

type QueueSummary = {
  pending: number
  processing: number
  completed: number
}

type ReviewFormState = {
  status: string
  latestScore: string
  latestFeedback: string
  encouragement: string
  strengths: string
  improvementPoints: string
}

const emptyFormState: ReviewFormState = {
  status: 'processing',
  latestScore: '',
  latestFeedback: '',
  encouragement: '',
  strengths: '',
  improvementPoints: '',
}

export function SubmissionsPage() {
  const { memberships } = useAuth()
  const [rows, setRows] = useState<SubmissionQueueRow[]>([])
  const [summary, setSummary] = useState<QueueSummary>({
    pending: 0,
    processing: 0,
    completed: 0,
  })
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null)
  const [formState, setFormState] = useState<ReviewFormState>(emptyFormState)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null)
  const [audioPreviewLoading, setAudioPreviewLoading] = useState(false)
  const [audioPreviewError, setAudioPreviewError] = useState<string | null>(null)

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

  const selectedRow = useMemo(
    () => rows.find((item) => item.id === selectedSubmissionId) ?? null,
    [rows, selectedSubmissionId],
  )

  const loadRows = async () => {
    const assignmentQuery =
      canViewWholeSchool || classIds.length === 0
        ? supabase.from('assignments').select('id, title, class_id').in('school_id', schoolIds)
        : supabase.from('assignments').select('id, title, class_id').in('class_id', classIds)

    const { data: assignmentsData, error: assignmentsError } = await assignmentQuery

    if (assignmentsError || !assignmentsData?.length) {
      setRows([])
      setSummary({ pending: 0, processing: 0, completed: 0 })
      setLoadError(assignmentsError?.message ?? null)
      return
    }

    const assignments = assignmentsData as AssignmentRow[]
    const assignmentIds = assignments.map((item) => item.id)
    const classIdList = Array.from(new Set(assignments.map((item) => item.class_id)))

    const [
      submissionsResponse,
      profilesResponse,
      classesResponse,
      evaluationResultsResponse,
      submissionAssetsResponse,
    ] = await Promise.all([
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
      supabase
        .from('evaluation_results')
        .select('submission_id, encouragement, strengths, improvement_points')
        .order('updated_at', { ascending: false }),
      supabase
        .from('submission_assets')
        .select('submission_id, storage_path')
        .eq('asset_type', 'audio')
        .order('created_at', { ascending: false }),
    ])

    if (
      submissionsResponse.error ||
      profilesResponse.error ||
      classesResponse.error ||
      evaluationResultsResponse.error ||
      submissionAssetsResponse.error
    ) {
      setRows([])
      setSummary({ pending: 0, processing: 0, completed: 0 })
      setLoadError(
        submissionsResponse.error?.message ||
          profilesResponse.error?.message ||
          classesResponse.error?.message ||
          evaluationResultsResponse.error?.message ||
          submissionAssetsResponse.error?.message ||
          '点评队列加载失败',
      )
      return
    }

    const submissions = (submissionsResponse.data ?? []) as SubmissionRow[]
    const evaluationResults = (evaluationResultsResponse.data ?? []) as EvaluationResultRow[]
    const submissionAssets = (submissionAssetsResponse.data ?? []) as SubmissionAssetRow[]

    const assignmentMap = new Map(assignments.map((item) => [item.id, item]))
    const classMap = new Map(
      ((classesResponse.data ?? []) as ClassRow[]).map((item) => [item.id, item.name]),
    )
    const profileMap = new Map(
      ((profilesResponse.data ?? []) as ProfileRow[]).map((item) => [item.id, item.display_name ?? item.id]),
    )
    const evaluationMap = new Map(
      evaluationResults.map((item) => [item.submission_id, item]),
    )
    const audioMap = new Map<string, SubmissionAssetRow>()
    submissionAssets.forEach((item) => {
      if (!audioMap.has(item.submission_id)) {
        audioMap.set(item.submission_id, item)
      }
    })

    let pending = 0
    let processing = 0
    let completed = 0

    const mappedRows = submissions.map((item) => {
      if (item.status === 'uploaded' || item.status === 'queued') pending += 1
      else if (item.status === 'processing') processing += 1
      else if (item.status === 'completed') completed += 1

      const assignment = assignmentMap.get(item.assignment_id)
      const className = assignment?.class_id
        ? classMap.get(assignment.class_id) ?? assignment.class_id
        : '未分班'
      const evaluation = evaluationMap.get(item.id)
      const latestFeedback = item.latest_feedback || '等待老师点评或系统评分'
      const audioFileName = fileNameFromPath(audioMap.get(item.id)?.storage_path)

      return {
        id: item.id,
        studentName: profileMap.get(item.student_id) ?? item.student_id,
        className,
        assignmentTitle: assignment?.title ?? item.assignment_id,
        status: item.status,
        statusLabel: mapSubmissionStatus(item.status),
        submittedAt: item.submitted_at ? new Date(item.submitted_at).toLocaleString() : '尚未提交时间',
        latestScore: item.latest_score != null ? `${item.latest_score}` : '-',
        latestScoreValue: item.latest_score,
        latestFeedback,
        latestFeedbackValue: item.latest_feedback ?? '',
        encouragement: evaluation?.encouragement ?? '',
        strengths: asStringList(evaluation?.strengths),
        improvementPoints: asStringList(evaluation?.improvement_points),
        audioFileName,
        audioStoragePath: audioMap.get(item.id)?.storage_path ?? null,
      }
    })

    setRows(mappedRows)
    setSummary({ pending, processing, completed })
    setLoadError(null)
    setSelectedSubmissionId((current) => {
      if (current && mappedRows.some((item) => item.id === current)) return current
      return mappedRows[0]?.id ?? null
    })
  }

  useEffect(() => {
    void loadRows()
  }, [canViewWholeSchool, classIds, memberships, schoolIds])

  useEffect(() => {
    if (!selectedRow) {
      setFormState(emptyFormState)
      return
    }

    setFormState({
      status: selectedRow.status === 'uploaded' ? 'queued' : selectedRow.status,
      latestScore:
        selectedRow.latestScoreValue != null ? `${selectedRow.latestScoreValue}` : '',
      latestFeedback:
        selectedRow.latestFeedbackValue && selectedRow.latestFeedbackValue !== '等待老师点评或系统评分'
          ? selectedRow.latestFeedbackValue
          : '',
      encouragement: selectedRow.encouragement,
      strengths: selectedRow.strengths.join('\n'),
      improvementPoints: selectedRow.improvementPoints.join('\n'),
    })
    setSaveError(null)
    setSaveSuccess(null)
  }, [selectedRow])

  useEffect(() => {
    let alive = true

    const loadAudioPreview = async () => {
      if (!selectedRow?.audioStoragePath) {
        setAudioPreviewUrl(null)
        setAudioPreviewError(null)
        setAudioPreviewLoading(false)
        return
      }

      setAudioPreviewLoading(true)
      setAudioPreviewError(null)

      const { data, error } = await supabase.storage
        .from('submission-audio')
        .createSignedUrl(selectedRow.audioStoragePath, 60 * 60)

      if (!alive) return

      if (error || !data?.signedUrl) {
        setAudioPreviewUrl(null)
        setAudioPreviewError(error?.message ?? '音频预览地址生成失败')
        setAudioPreviewLoading(false)
        return
      }

      setAudioPreviewUrl(data.signedUrl)
      setAudioPreviewLoading(false)
    }

    void loadAudioPreview()

    return () => {
      alive = false
    }
  }, [selectedRow?.audioStoragePath])

  const handleSave = async () => {
    if (!selectedRow) return

    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(null)

    const latestScore =
      formState.latestScore.trim() === '' ? null : Number(formState.latestScore.trim())

    if (latestScore != null && Number.isNaN(latestScore)) {
      setSaveError('分数需要填写数字。')
      setIsSaving(false)
      return
    }

    const strengths = splitLines(formState.strengths)
    const improvementPoints = splitLines(formState.improvementPoints)

    const { error: updateSubmissionError } = await supabase
      .from('submissions')
      .update({
        status: formState.status,
        latest_score: latestScore,
        latest_feedback: formState.latestFeedback.trim() || null,
      })
      .eq('id', selectedRow.id)

    if (updateSubmissionError) {
      setSaveError(updateSubmissionError.message)
      setIsSaving(false)
      return
    }

    const shouldPersistEvaluation =
      latestScore != null ||
      formState.encouragement.trim() !== '' ||
      strengths.length > 0 ||
      improvementPoints.length > 0

    if (shouldPersistEvaluation) {
      const { error: evaluationError } = await supabase
        .from('evaluation_results')
        .upsert(
          {
            submission_id: selectedRow.id,
            provider: 'teacher-review',
            overall_score: latestScore,
            strengths,
            improvement_points: improvementPoints,
            encouragement: formState.encouragement.trim() || null,
          },
          { onConflict: 'submission_id' },
        )

      if (evaluationError) {
        setSaveError(evaluationError.message)
        setIsSaving(false)
        return
      }
    }

    setSaveSuccess('点评已经保存，学生端刷新后就能看到。')
    setIsSaving(false)
    await loadRows()
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Queue</span>
          <h1>点评队列</h1>
          <p>先看待查看，再补评分和反馈，学生提交后就能在学生端立即看到老师点评。</p>
        </div>
      </header>

      <div className="stat-grid teacher-dashboard-grid">
        <QueueStatCard title="待查看" value={String(summary.pending)} note="刚提交或排队中的记录" />
        <QueueStatCard title="处理中" value={String(summary.processing)} note="已经开始处理但还没完成点评" />
        <QueueStatCard title="已完成" value={String(summary.completed)} note="已经产生分数或反馈的记录" />
      </div>

      {loadError ? <div className="error-banner">{loadError}</div> : null}

      {rows.length === 0 ? (
        <div className="empty-state">当前还没有可见提交记录。</div>
      ) : (
        <div className="review-workbench">
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
                  <tr
                    key={row.id}
                    className={row.id === selectedSubmissionId ? 'table-row-active' : undefined}
                    onClick={() => setSelectedSubmissionId(row.id)}
                  >
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

          <aside className="panel review-panel">
            <div className="panel-heading">
              <div>
                <h2>点评面板</h2>
                <p className="panel-copy">
                  {selectedRow
                    ? `${selectedRow.studentName} · ${selectedRow.assignmentTitle}`
                    : '请选择一条提交记录'}
                </p>
              </div>
              {selectedRow ? (
                <span className="status-chip">{mapSubmissionStatus(selectedRow.status)}</span>
              ) : null}
            </div>

            {selectedRow ? (
              <>
                <div className="review-meta">
                  <MetaItem label="班级" value={selectedRow.className} />
                  <MetaItem label="提交时间" value={selectedRow.submittedAt} />
                  <MetaItem label="音频附件" value={selectedRow.audioFileName ?? '暂未上传附件'} />
                </div>

                <AudioPreviewCard
                  fileName={selectedRow.audioFileName}
                  previewUrl={audioPreviewUrl}
                  loading={audioPreviewLoading}
                  error={audioPreviewError}
                />

                {saveError ? <div className="error-banner">{saveError}</div> : null}
                {saveSuccess ? <div className="success-banner">{saveSuccess}</div> : null}

                <div className="inline-form">
                  <label>
                    处理状态
                    <select
                      value={formState.status}
                      onChange={(event) =>
                        setFormState((current) => ({ ...current, status: event.target.value }))
                      }
                    >
                      <option value="queued">待查看</option>
                      <option value="processing">处理中</option>
                      <option value="completed">已完成</option>
                      <option value="failed">需要重提</option>
                    </select>
                  </label>

                  <label>
                    老师评分
                    <input
                      value={formState.latestScore}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          latestScore: event.target.value,
                        }))
                      }
                      placeholder="例如 95"
                    />
                  </label>

                  <label className="span-2">
                    点评反馈
                    <textarea
                      rows={4}
                      value={formState.latestFeedback}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          latestFeedback: event.target.value,
                        }))
                      }
                      placeholder="写给学生的主要反馈，学生端会直接展示。"
                    />
                  </label>

                  <label className="span-2">
                    鼓励语
                    <textarea
                      rows={3}
                      value={formState.encouragement}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          encouragement: event.target.value,
                        }))
                      }
                      placeholder="例如：继续保持这个节奏，下次把句尾收音再干净一点。"
                    />
                  </label>

                  <label className="span-2">
                    做得好的地方
                    <textarea
                      rows={4}
                      value={formState.strengths}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          strengths: event.target.value,
                        }))
                      }
                      placeholder={'每行一条，例如：\n开头发音清晰\n整体节奏稳定'}
                    />
                  </label>

                  <label className="span-2">
                    下次继续加强
                    <textarea
                      rows={4}
                      value={formState.improvementPoints}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          improvementPoints: event.target.value,
                        }))
                      }
                      placeholder={'每行一条，例如：\n句尾收音再干净一点'}
                    />
                  </label>
                </div>

                <div className="form-actions">
                  <button className="primary-button" type="button" onClick={() => void handleSave()} disabled={isSaving}>
                    {isSaving ? '保存中...' : '保存点评'}
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-inline">左侧选择一条提交记录后，就能开始填写点评。</div>
            )}
          </aside>
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

function splitLines(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function asStringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item))
}

function fileNameFromPath(path?: string) {
  if (!path) return null
  const segments = path.split('/')
  return segments[segments.length - 1] || path
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

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="review-meta-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function AudioPreviewCard({
  fileName,
  previewUrl,
  loading,
  error,
}: {
  fileName: string | null
  previewUrl: string | null
  loading: boolean
  error: string | null
}) {
  return (
    <div className="audio-preview-card">
      <div className="audio-preview-header">
        <div>
          <strong>学生音频</strong>
          <p>{fileName ?? '当前还没有音频附件'}</p>
        </div>
        {previewUrl ? (
          <a className="quick-link" href={previewUrl} target="_blank" rel="noreferrer">
            新窗口打开
          </a>
        ) : null}
      </div>

      {loading ? <div className="empty-inline">正在生成试听链接...</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {!loading && !error && !previewUrl ? (
        <div className="empty-inline">学生还没有上传可试听的音频。</div>
      ) : null}
      {previewUrl ? <audio className="audio-player" controls src={previewUrl} /> : null}
    </div>
  )
}
