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
  provider: string | null
  overall_score: number | null
  pronunciation_score: number | null
  fluency_score: number | null
  completeness_score: number | null
  encouragement: string | null
  strengths: unknown
  improvement_points: unknown
  raw_result: unknown
}

type SubmissionAssetRow = {
  submission_id: string
  storage_path: string
}

type EvaluationJobRow = {
  submission_id: string
  status: string | null
  last_error: string | null
  attempt_count: number | null
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
  reviewProvider: string | null
  aiReview: AiReviewSnapshot | null
  aiJobStatus: string | null
  aiLastError: string | null
  aiAttemptCount: number
}

type AiReviewSnapshot = {
  provider: string
  summaryFeedback: string
  transcript: string
  overallScore: number | null
  pronunciationScore: number | null
  fluencyScore: number | null
  completenessScore: number | null
  strengths: string[]
  improvementPoints: string[]
  encouragement: string
}

type QueueSummary = {
  pending: number
  processing: number
  completed: number
  aiFailed: number
}

type QueueFilter = 'all' | 'aiFailed' | 'pending' | 'processing' | 'completed'

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
    aiFailed: 0,
  })
  const [activeFilter, setActiveFilter] = useState<QueueFilter>('all')
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null)
  const [formState, setFormState] = useState<ReviewFormState>(emptyFormState)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null)
  const [audioPreviewLoading, setAudioPreviewLoading] = useState(false)
  const [audioPreviewError, setAudioPreviewError] = useState<string | null>(null)
  const [isRetryingAiReview, setIsRetryingAiReview] = useState(false)
  const [isBatchRetryingAiReview, setIsBatchRetryingAiReview] = useState(false)

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

  const filteredRows = useMemo(() => {
    switch (activeFilter) {
      case 'aiFailed':
        return rows.filter((item) => item.aiJobStatus === 'failed')
      case 'pending':
        return rows.filter(
          (item) => item.status === 'uploaded' || item.status === 'queued',
        )
      case 'processing':
        return rows.filter((item) => item.status === 'processing')
      case 'completed':
        return rows.filter((item) => item.status === 'completed')
      case 'all':
      default:
        return rows
    }
  }, [activeFilter, rows])

  const retryableFilteredRows = useMemo(
    () => filteredRows.filter((item) => item.aiJobStatus === 'failed'),
    [filteredRows],
  )

  const nextAiFailedRow = useMemo(() => {
    if (retryableFilteredRows.length === 0) return null
    if (!selectedSubmissionId) return retryableFilteredRows[0]

    const currentIndex = retryableFilteredRows.findIndex(
      (item) => item.id === selectedSubmissionId,
    )
    if (currentIndex >= 0 && currentIndex + 1 < retryableFilteredRows.length) {
      return retryableFilteredRows[currentIndex + 1]
    }
    return retryableFilteredRows.find((item) => item.id !== selectedSubmissionId) ?? null
  }, [retryableFilteredRows, selectedSubmissionId])

  const loadRows = async () => {
    const assignmentQuery =
      canViewWholeSchool || classIds.length === 0
        ? supabase.from('assignments').select('id, title, class_id').in('school_id', schoolIds)
        : supabase.from('assignments').select('id, title, class_id').in('class_id', classIds)

    const { data: assignmentsData, error: assignmentsError } = await assignmentQuery

    if (assignmentsError || !assignmentsData?.length) {
      setRows([])
      setSummary({ pending: 0, processing: 0, completed: 0, aiFailed: 0 })
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
      evaluationJobsResponse,
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
        .select(
          'submission_id, provider, overall_score, pronunciation_score, fluency_score, completeness_score, encouragement, strengths, improvement_points, raw_result',
        )
        .order('updated_at', { ascending: false }),
      supabase
        .from('evaluation_jobs')
        .select('submission_id, status, last_error, attempt_count, updated_at')
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
      evaluationJobsResponse.error ||
      submissionAssetsResponse.error
    ) {
      setRows([])
      setSummary({ pending: 0, processing: 0, completed: 0, aiFailed: 0 })
      setLoadError(
        submissionsResponse.error?.message ||
          profilesResponse.error?.message ||
          classesResponse.error?.message ||
          evaluationResultsResponse.error?.message ||
          evaluationJobsResponse.error?.message ||
          submissionAssetsResponse.error?.message ||
          '点评队列加载失败',
      )
      return
    }

    const submissions = (submissionsResponse.data ?? []) as SubmissionRow[]
    const evaluationResults = (evaluationResultsResponse.data ?? []) as EvaluationResultRow[]
    const evaluationJobs = (evaluationJobsResponse.data ?? []) as EvaluationJobRow[]
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
    const evaluationJobMap = new Map(
      evaluationJobs.map((item) => [item.submission_id, item]),
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
    let aiFailed = 0

    const mappedRows = submissions.map((item) => {
      if (item.status === 'uploaded' || item.status === 'queued') pending += 1
      else if (item.status === 'processing') processing += 1
      else if (item.status === 'completed') completed += 1

      const assignment = assignmentMap.get(item.assignment_id)
      const className = assignment?.class_id
        ? classMap.get(assignment.class_id) ?? assignment.class_id
        : '未分班'
      const evaluation = evaluationMap.get(item.id)
      const evaluationJob = evaluationJobMap.get(item.id)
      if (evaluationJob?.status === 'failed') {
        aiFailed += 1
      }
      const latestFeedback = item.latest_feedback || '等待老师点评或系统评分'
      const audioFileName = fileNameFromPath(audioMap.get(item.id)?.storage_path)
      const aiReview = buildAiReviewSnapshot(
        evaluation,
        item.latest_feedback ?? '',
      )

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
        reviewProvider: evaluation?.provider ?? null,
        aiReview,
        aiJobStatus: evaluationJob?.status ?? null,
        aiLastError: evaluationJob?.last_error ?? null,
        aiAttemptCount: evaluationJob?.attempt_count ?? 0,
      }
    })

    setRows(mappedRows)
    setSummary({ pending, processing, completed, aiFailed })
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
    if (filteredRows.length === 0) {
      setSelectedSubmissionId(null)
      return
    }

    setSelectedSubmissionId((current) =>
      current && filteredRows.some((item) => item.id === current)
        ? current
        : filteredRows[0].id,
    )
  }, [filteredRows])

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

  const handleSave = async (moveToNext = false) => {
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
      const preservedAiReview = selectedRow.aiReview
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
            raw_result: preservedAiReview
              ? {
                  previousAiReview: {
                    provider: preservedAiReview.provider,
                    summaryFeedback: preservedAiReview.summaryFeedback,
                    transcript: preservedAiReview.transcript,
                    overallScore: preservedAiReview.overallScore,
                    pronunciationScore: preservedAiReview.pronunciationScore,
                    fluencyScore: preservedAiReview.fluencyScore,
                    completenessScore: preservedAiReview.completenessScore,
                    strengths: preservedAiReview.strengths,
                    improvementPoints: preservedAiReview.improvementPoints,
                    encouragement: preservedAiReview.encouragement,
                  },
                }
              : null,
          },
          { onConflict: 'submission_id' },
        )

      if (evaluationError) {
        setSaveError(evaluationError.message)
        setIsSaving(false)
        return
      }
    }

    const nextQueuedRow = moveToNext
      ? rows.find(
          (item) =>
            item.id !== selectedRow.id &&
            (item.status === 'uploaded' ||
              item.status === 'queued' ||
              item.status === 'processing'),
        )
      : null

    setSaveSuccess(
      moveToNext && nextQueuedRow
        ? '点评已经保存，已为你切到下一条待处理记录。'
        : '点评已经保存，学生端刷新后就能看到。',
    )
    setIsSaving(false)
    await loadRows()
    if (nextQueuedRow) {
      setSelectedSubmissionId(nextQueuedRow.id)
    }
  }

  const handleAdoptAiReview = () => {
    const aiReview = selectedRow?.aiReview
    if (!selectedRow || !aiReview) return

    setFormState((current) => ({
      ...current,
      status: current.status === 'failed' ? 'processing' : current.status,
      latestScore: aiReview.overallScore != null ? `${aiReview.overallScore}` : '',
      latestFeedback: aiReview.summaryFeedback,
      encouragement: aiReview.encouragement,
      strengths: aiReview.strengths.join('\n'),
      improvementPoints: aiReview.improvementPoints.join('\n'),
    }))
    setSaveSuccess('已把 AI 初评内容带入老师表单，你可以直接微调后保存。')
    setSaveError(null)
  }

  const handleRetryAiReview = async () => {
    if (!selectedRow) return

    setIsRetryingAiReview(true)
    setSaveError(null)
    setSaveSuccess(null)

    try {
      const message = await triggerAiReview(selectedRow.id)
      setSaveSuccess(
        message || '已经重新发起 AI 初评，请稍后刷新查看结果。',
      )
      await loadRows()
      setSelectedSubmissionId(selectedRow.id)
    } catch (retryError) {
      setSaveError(
        retryError instanceof Error
          ? retryError.message
          : '重新发起 AI 初评失败，请稍后再试。',
      )
    } finally {
      setIsRetryingAiReview(false)
    }
  }

  const handleRetryFilteredAiReviews = async () => {
    if (retryableFilteredRows.length === 0) return

    setIsBatchRetryingAiReview(true)
    setSaveError(null)
    setSaveSuccess(null)

    let successCount = 0
    const failureMessages: string[] = []

    for (const row of retryableFilteredRows) {
      try {
        await triggerAiReview(row.id)
        successCount += 1
      } catch (error) {
        failureMessages.push(
          `${row.studentName}：${error instanceof Error ? error.message : '重试失败'}`,
        )
      }
    }

    await loadRows()

    if (failureMessages.length > 0) {
      setSaveError(failureMessages.join('；'))
    }
    if (successCount > 0) {
      setSaveSuccess(`已重新发起 ${successCount} 条 AI 初评。`)
    }

    setIsBatchRetryingAiReview(false)
  }

  const handleJumpToNextAiFailed = () => {
    if (!nextAiFailedRow) return
    setSelectedSubmissionId(nextAiFailedRow.id)
    setSaveSuccess(`已切到下一条 AI 失败记录：${nextAiFailedRow.studentName}。`)
    setSaveError(null)
  }

  const triggerAiReview = async (submissionId: string) => {
    const { data, error } = await supabase.functions.invoke('ai-review-submission', {
      body: {
        action: 'review_submission',
        submissionId,
      },
    })

    if (error) {
      throw error
    }

    if (data?.error) {
      throw new Error(data.error as string)
    }

    return typeof data?.message === 'string' && data.message.trim() !== ''
      ? data.message
      : null
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
        <QueueStatCard title="AI 异常" value={String(summary.aiFailed)} note="优先处理这些失败的 AI 初评记录" />
      </div>

      {loadError ? <div className="error-banner">{loadError}</div> : null}

      {rows.length === 0 ? (
        <div className="empty-state">当前还没有可见提交记录。</div>
      ) : (
        <div className="review-workbench">
          <div className="table-card">
            <div className="queue-filter-bar">
              <span>快捷筛选</span>
              <div className="helper-stack">
                <button
                  type="button"
                  className={`filter-chip ${activeFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('all')}
                >
                  全部
                </button>
                <button
                  type="button"
                  className={`filter-chip danger ${activeFilter === 'aiFailed' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('aiFailed')}
                >
                  AI 失败
                </button>
                <button
                  type="button"
                  className={`filter-chip ${activeFilter === 'pending' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('pending')}
                >
                  待查看
                </button>
                <button
                  type="button"
                  className={`filter-chip ${activeFilter === 'processing' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('processing')}
                >
                  处理中
                </button>
                <button
                  type="button"
                  className={`filter-chip ${activeFilter === 'completed' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('completed')}
                >
                  已完成
                </button>
              </div>
              {retryableFilteredRows.length > 0 ? (
                <div className="queue-filter-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void handleRetryFilteredAiReviews()}
                    disabled={isBatchRetryingAiReview}
                  >
                    {isBatchRetryingAiReview
                      ? '批量重试中...'
                      : `批量重试 ${retryableFilteredRows.length} 条 AI 失败`}
                  </button>
                  <span>适合先把当前筛选里的 AI 异常单统一重新发起一轮。</span>
                </div>
              ) : null}
            </div>

            {filteredRows.length === 0 ? (
              <div className="empty-inline queue-filter-empty">当前筛选下没有记录。</div>
            ) : null}
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
                {filteredRows.map((row) => (
                  <tr
                    key={row.id}
                    className={row.id === selectedSubmissionId ? 'table-row-active' : undefined}
                    onClick={() => setSelectedSubmissionId(row.id)}
                  >
                    <td>{row.studentName}</td>
                    <td>{row.className}</td>
                    <td>{row.assignmentTitle}</td>
                    <td>
                      <div className="helper-stack">
                        <span>{row.statusLabel}</span>
                        {row.aiJobStatus === 'failed' ? (
                          <span className="helper-chip danger">AI 失败</span>
                        ) : null}
                      </div>
                    </td>
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

                <AiReviewCard
                  aiReview={selectedRow.aiReview}
                  currentProvider={selectedRow.reviewProvider}
                  onAdopt={handleAdoptAiReview}
                  aiJobStatus={selectedRow.aiJobStatus}
                  aiLastError={selectedRow.aiLastError}
                  aiAttemptCount={selectedRow.aiAttemptCount}
                  onRetry={handleRetryAiReview}
                  retrying={isRetryingAiReview}
                />

                {saveError ? <div className="error-banner">{saveError}</div> : null}
                {saveSuccess ? <div className="success-banner">{saveSuccess}</div> : null}

                {nextAiFailedRow ? (
                  <div className="queue-filter-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={handleJumpToNextAiFailed}
                    >
                      查看下一条 AI 失败
                    </button>
                    <span>适合老师连续处理异常单，不用回到左侧列表重新点选。</span>
                  </div>
                ) : null}

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
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={isSaving}
                  >
                    {isSaving ? '保存中...' : '保存点评'}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void handleSave(true)}
                    disabled={isSaving}
                  >
                    保存并看下一条
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

function AiReviewCard({
  aiReview,
  currentProvider,
  onAdopt,
  aiJobStatus,
  aiLastError,
  aiAttemptCount,
  onRetry,
  retrying,
}: {
  aiReview: AiReviewSnapshot | null
  currentProvider: string | null
  onAdopt: () => void
  aiJobStatus: string | null
  aiLastError: string | null
  aiAttemptCount: number
  onRetry: () => void
  retrying: boolean
}) {
  const aiStatusLabel = mapAiJobStatus(aiJobStatus)
  const aiStatusTone = aiJobStatus === 'failed' ? 'danger' : aiJobStatus === 'completed' ? 'success' : 'muted'

  if (!aiReview) {
    return (
      <div className="ai-review-card">
        <div className="audio-preview-header">
          <div>
            <strong>AI 初评</strong>
            <p>
              {aiJobStatus === 'failed'
                ? '这条作业的 AI 初评没有成功，老师可以先看失败原因，再决定重试还是直接人工点评。'
                : '当前还没有可参考的 AI transcript 或评分结果。'}
            </p>
          </div>
          <div className="helper-stack">
            <span className={`helper-chip ${aiStatusTone}`}>{aiStatusLabel}</span>
            {aiAttemptCount > 0 ? (
              <span className="helper-chip muted">尝试 {aiAttemptCount} 次</span>
            ) : null}
          </div>
        </div>
        {aiLastError ? (
          <div className="error-banner">
            <strong>AI 失败原因：</strong>
            {friendlyTeacherAiError(aiLastError)}
          </div>
        ) : (
          <div className="empty-inline">AI 初评还没有开始，或者结果还没回写到这条记录。</div>
        )}
        {(aiJobStatus === 'failed' || aiJobStatus == null) ? (
          <div className="speech-preview-actions">
            <button className="ghost-button" type="button" onClick={onRetry} disabled={retrying}>
              {retrying ? '重试中...' : '重新发起 AI 初评'}
            </button>
            <span>如果学生音频已经上传成功，可以先重新发起一次 AI 初评；不行的话老师也可以直接人工点评。</span>
          </div>
        ) : null}
      </div>
    )
  }

  const isTeacherReviewed = currentProvider === 'teacher-review'

  return (
    <div className="ai-review-card">
      <div className="audio-preview-header">
        <div>
          <strong>AI 初评</strong>
          <p>
            {isTeacherReviewed
              ? '老师已经复核过这条作业，下面保留的是 AI 初评快照，方便回看。'
              : '这是系统先给出的 transcript、分数和建议，老师可以直接采用或继续微调。'}
          </p>
        </div>
        <div className="helper-stack">
          <span className={`helper-chip ${isTeacherReviewed ? '' : 'success'}`}>
            {isTeacherReviewed ? '已复核' : '可参考'}
          </span>
          <span className={`helper-chip ${aiStatusTone}`}>{aiStatusLabel}</span>
          <span className="helper-chip muted">{aiReview.provider}</span>
        </div>
      </div>

      {aiLastError ? (
        <div className="error-banner">
          <strong>最近一次 AI 失败：</strong>
          {friendlyTeacherAiError(aiLastError)}
        </div>
      ) : null}

      <div className="ai-review-grid">
        <MetaItem
          label="AI 总分"
          value={aiReview.overallScore != null ? `${aiReview.overallScore}` : '-'}
        />
        <MetaItem
          label="发音"
          value={
            aiReview.pronunciationScore != null ? `${aiReview.pronunciationScore}` : '-'
          }
        />
        <MetaItem
          label="流利度"
          value={aiReview.fluencyScore != null ? `${aiReview.fluencyScore}` : '-'}
        />
        <MetaItem
          label="完整度"
          value={aiReview.completenessScore != null ? `${aiReview.completenessScore}` : '-'}
        />
      </div>

      <div className="ai-review-section">
        <span>AI transcript</span>
        <strong>{aiReview.transcript || '暂时没有转写内容'}</strong>
      </div>

      <div className="ai-review-section">
        <span>AI 总结</span>
        <p>{aiReview.summaryFeedback || '暂时没有总结反馈。'}</p>
      </div>

      <div className="ai-review-list-grid">
        <ReviewList
          title="做得好的地方"
          items={aiReview.strengths}
          emptyText="AI 暂时没有提取优点。"
        />
        <ReviewList
          title="建议继续加强"
          items={aiReview.improvementPoints}
          emptyText="AI 暂时没有提取建议。"
        />
      </div>

      <div className="ai-review-section">
        <span>鼓励语</span>
        <p>{aiReview.encouragement || '继续加油，老师会再补充点评。'}</p>
      </div>

      <div className="speech-preview-actions">
        <button className="ghost-button" type="button" onClick={onAdopt}>
          采用 AI 初评到表单
        </button>
        {aiJobStatus === 'failed' ? (
          <button className="ghost-button" type="button" onClick={onRetry} disabled={retrying}>
            {retrying ? '重试中...' : '重新发起 AI 初评'}
          </button>
        ) : null}
        <span>会把 AI 总结、分数、优点和建议带入右侧老师表单，方便直接复核。</span>
      </div>
    </div>
  )
}

function ReviewList({
  title,
  items,
  emptyText,
}: {
  title: string
  items: string[]
  emptyText: string
}) {
  return (
    <div className="ai-review-list">
      <span>{title}</span>
      {items.length === 0 ? (
        <p>{emptyText}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function buildAiReviewSnapshot(
  evaluation: EvaluationResultRow | undefined,
  latestFeedback: string,
): AiReviewSnapshot | null {
  if (!evaluation) return null

  if (evaluation.provider === 'teacher-review') {
    return readStoredAiReviewSnapshot(evaluation.raw_result)
  }

  return {
    provider: evaluation.provider ?? 'ai-review',
    summaryFeedback: latestFeedback.trim(),
    transcript: readTranscript(evaluation.raw_result),
    overallScore: evaluation.overall_score,
    pronunciationScore: evaluation.pronunciation_score,
    fluencyScore: evaluation.fluency_score,
    completenessScore: evaluation.completeness_score,
    strengths: asStringList(evaluation.strengths),
    improvementPoints: asStringList(evaluation.improvement_points),
    encouragement: evaluation.encouragement ?? '',
  }
}

function readStoredAiReviewSnapshot(rawResult: unknown): AiReviewSnapshot | null {
  const record = asRecord(rawResult)
  const previous = asRecord(record?.previousAiReview)
  if (!previous) return null

  return {
    provider: asString(previous.provider) ?? 'ai-review',
    summaryFeedback: asString(previous.summaryFeedback) ?? '',
    transcript: asString(previous.transcript) ?? '',
    overallScore: asNumber(previous.overallScore),
    pronunciationScore: asNumber(previous.pronunciationScore),
    fluencyScore: asNumber(previous.fluencyScore),
    completenessScore: asNumber(previous.completenessScore),
    strengths: asStringList(previous.strengths),
    improvementPoints: asStringList(previous.improvementPoints),
    encouragement: asString(previous.encouragement) ?? '',
  }
}

function readTranscript(rawResult: unknown) {
  const record = asRecord(rawResult)
  return asString(record?.transcript) ?? ''
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function mapAiJobStatus(status: string | null) {
  if (status === 'failed') return 'AI 初评失败'
  if (status === 'completed') return 'AI 初评完成'
  if (status === 'processing') return 'AI 处理中'
  if (status === 'queued' || status === 'pending') return 'AI 排队中'
  return 'AI 未开始'
}

function friendlyTeacherAiError(error: string) {
  const lowered = error.toLowerCase()
  if (lowered.includes('transcription')) {
    return '系统没有成功转写学生音频，建议让学生换一个安静环境重新提交，或者老师直接人工点评。'
  }
  if (
    lowered.includes('503') ||
    lowered.includes('temporarily unavailable') ||
    lowered.includes('timeout')
  ) {
    return '上游 AI 服务刚才不可用，可以稍后重新发起一次 AI 初评。'
  }
  if (lowered.includes('download')) {
    return '系统没有成功读取学生音频附件，建议让学生重新提交一次。'
  }
  return error
}
