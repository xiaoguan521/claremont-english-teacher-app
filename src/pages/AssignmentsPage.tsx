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

type AssignmentItemRow = {
  assignment_id: string
  item_type: string
  title: string | null
  prompt_text: string
  expected_text: string | null
  tts_text: string | null
  reference_audio_path: string | null
  region_id: string | null
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

type MaterialPageRow = {
  id: string
  page_number: number
}

type MaterialPageRegionRow = {
  id: string
  material_page_id: string
  display_text: string
  prompt_text: string | null
  expected_text: string | null
  tts_text: string | null
  sort_order: number
}

type MaterialRegionAssetRow = {
  region_id: string
  asset_role: string
  storage_bucket: string
  storage_path: string
}

type MaterialRegionOption = {
  id: string
  materialPageId: string
  pageNumber: number
  displayText: string
  promptText: string | null
  expectedText: string | null
  ttsText: string | null
  referenceAudioPath: string | null
  sortOrder: number
}

type AssignmentView = AssignmentRow & {
  submittedCount: number
  pendingCount: number
  submissionRate: number
  itemType: string
  itemTitle: string | null
  promptText: string
  expectedText: string | null
  ttsText: string | null
  referenceAudioPath: string | null
  regionId: string | null
}

export function AssignmentsPage() {
  const { memberships, session } = useAuth()
  const [rows, setRows] = useState<AssignmentView[]>([])
  const [classNames, setClassNames] = useState<Record<string, string>>({})
  const [classOptions, setClassOptions] = useState<ClassOption[]>([])
  const [materialOptions, setMaterialOptions] = useState<MaterialOption[]>([])
  const [materialRegionOptions, setMaterialRegionOptions] = useState<MaterialRegionOption[]>([])
  const [loadingMaterialRegions, setLoadingMaterialRegions] = useState(false)
  const [selectedReferenceAudio, setSelectedReferenceAudio] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [speechPreviewUrl, setSpeechPreviewUrl] = useState<string | null>(null)
  const [speechPreviewBlob, setSpeechPreviewBlob] = useState<Blob | null>(null)
  const [speechPreviewMeta, setSpeechPreviewMeta] = useState<{
    providerLabel: string
    model: string
    mimeType: string
    text: string
    cached: boolean
    storagePath: string | null
  } | null>(null)
  const [speechGenerating, setSpeechGenerating] = useState(false)
  const [savingSpeechReference, setSavingSpeechReference] = useState(false)
  const [speechError, setSpeechError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    classId: '',
    materialId: '',
    title: '',
    description: '',
    dueAt: '',
    status: 'draft',
    regionId: '',
    itemType: 'sentence',
    itemTitle: '',
    promptText: '',
    expectedText: '',
    ttsText: '',
    referenceAudioPath: '',
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

        const [submissionResponse, studentMembershipResponse, assignmentItemsResponse] =
          await Promise.all([
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
          assignmentIds.length
            ? supabase
              .from('assignment_items')
              .select(
                  'assignment_id, item_type, title, prompt_text, expected_text, tts_text, reference_audio_path, region_id, sort_order',
                )
                .in('assignment_id', assignmentIds)
                .order('sort_order', { ascending: true })
            : Promise.resolve({ data: [], error: null }),
        ])

        const submissionRows = (submissionResponse.data ?? []) as SubmissionRow[]
        const studentMemberships = (studentMembershipResponse.data ?? []) as MembershipRow[]
        const assignmentItems = (assignmentItemsResponse.data ?? []) as AssignmentItemRow[]

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

        const firstItemByAssignment = new Map<string, AssignmentItemRow>()
        assignmentItems.forEach((item) => {
          if (!firstItemByAssignment.has(item.assignment_id)) {
            firstItemByAssignment.set(item.assignment_id, item)
          }
        })

        setRows(
          assignments.map((assignment) => {
            const submittedCount = submittedCountByAssignment.get(assignment.id) ?? 0
            const expectedStudents = studentsByClass.get(assignment.class_id) ?? 0
            const firstItem = firstItemByAssignment.get(assignment.id)

            return {
              ...assignment,
              submittedCount,
              pendingCount: pendingCountByAssignment.get(assignment.id) ?? 0,
              submissionRate:
                expectedStudents > 0
                  ? Math.round((submittedCount / expectedStudents) * 100)
                  : 0,
              itemType: firstItem?.item_type ?? 'sentence',
              itemTitle: firstItem?.title ?? null,
              promptText: firstItem?.prompt_text ?? '',
              expectedText: firstItem?.expected_text ?? null,
              ttsText: firstItem?.tts_text ?? null,
              referenceAudioPath: firstItem?.reference_audio_path ?? null,
              regionId: firstItem?.region_id ?? null,
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

  useEffect(() => {
    const loadMaterialRegions = async () => {
      if (!form.materialId) {
        setMaterialRegionOptions([])
        setForm((current) => ({ ...current, regionId: '' }))
        return
      }

      setLoadingMaterialRegions(true)

      const { data: pagesData, error: pagesError } = await supabase
        .from('material_pages')
        .select('id, page_number')
        .eq('material_id', form.materialId)
        .eq('status', 'active')
        .order('page_number')

      if (pagesError) {
        setLoadingMaterialRegions(false)
        setMaterialRegionOptions([])
        return
      }

      const materialPages = (pagesData ?? []) as MaterialPageRow[]
      const pageIds = materialPages.map((item) => item.id)
      if (pageIds.length === 0) {
        setLoadingMaterialRegions(false)
        setMaterialRegionOptions([])
        setForm((current) => ({ ...current, regionId: '' }))
        return
      }

      const regionsResponse = await supabase
        .from('material_page_regions')
        .select(
          'id, material_page_id, display_text, prompt_text, expected_text, tts_text, sort_order',
        )
        .in('material_page_id', pageIds)
        .eq('status', 'active')
        .order('sort_order', { ascending: true })

      if (regionsResponse.error) {
        setLoadingMaterialRegions(false)
        setMaterialRegionOptions([])
        return
      }

      const regionRows = (regionsResponse.data ?? []) as MaterialPageRegionRow[]
      const regionIds = regionRows.map((item) => item.id)

      let assetRows: MaterialRegionAssetRow[] = []
      if (regionIds.length > 0) {
        const { data: fetchedAssets } = await supabase
          .from('material_region_assets')
          .select('region_id, asset_role, storage_bucket, storage_path')
          .in('region_id', regionIds)
          .eq('status', 'active')
          .in('asset_role', ['reference_audio', 'ai_reference_audio'])
          .order('sort_order', { ascending: true })
        assetRows = (fetchedAssets ?? []) as MaterialRegionAssetRow[]
      }

      const pageNumbersById = new Map(materialPages.map((item) => [item.id, item.page_number]))
      const referenceAudioByRegion = new Map<string, string>()
      assetRows.forEach((asset) => {
        if (!referenceAudioByRegion.has(asset.region_id)) {
          referenceAudioByRegion.set(
            asset.region_id,
            `${asset.storage_bucket}:${asset.storage_path}`,
          )
        }
      })

      const nextOptions = regionRows
        .map((region) => ({
          id: region.id,
          materialPageId: region.material_page_id,
          pageNumber: pageNumbersById.get(region.material_page_id) ?? 0,
          displayText: region.display_text,
          promptText: region.prompt_text,
          expectedText: region.expected_text,
          ttsText: region.tts_text,
          referenceAudioPath: referenceAudioByRegion.get(region.id) ?? null,
          sortOrder: region.sort_order,
        }))
        .sort((left, right) =>
          left.pageNumber === right.pageNumber
            ? left.sortOrder - right.sortOrder
            : left.pageNumber - right.pageNumber,
        )

      setMaterialRegionOptions(nextOptions)
      setForm((current) => {
        const regionStillExists = nextOptions.some((item) => item.id === current.regionId)
        return {
          ...current,
          regionId: regionStillExists ? current.regionId : '',
        }
      })
      setLoadingMaterialRegions(false)
    }

    void loadMaterialRegions()
  }, [form.materialId])

  useEffect(() => {
    if (!form.regionId) return
    const selectedRegion = materialRegionOptions.find((item) => item.id === form.regionId)
    if (!selectedRegion) return

    setSelectedReferenceAudio(null)
    setForm((current) => ({
      ...current,
      itemType: 'sentence',
      itemTitle:
        current.itemTitle.trim() && current.regionId === selectedRegion.id
          ? current.itemTitle
          : `教材句子 · 第 ${selectedRegion.pageNumber} 页`,
      promptText: selectedRegion.promptText?.trim() || selectedRegion.displayText,
      expectedText:
        selectedRegion.expectedText?.trim() || selectedRegion.displayText,
      ttsText:
        selectedRegion.ttsText?.trim()
        || selectedRegion.expectedText?.trim()
        || selectedRegion.displayText,
      referenceAudioPath: selectedRegion.referenceAudioPath ?? current.referenceAudioPath,
    }))
  }, [form.regionId, materialRegionOptions])

  const uploadReferenceAudio = async ({
    audioFile,
    schoolId,
    fileName,
  }: {
    audioFile: Blob
    schoolId: string
    fileName: string
  }) => {
    const safeName = fileName.replace(/\s+/g, '-')
    const objectPath = `${schoolId}/reference-audio/${Date.now()}-${safeName}`
    const { error: uploadError } = await supabase.storage
      .from('reference-audio')
      .upload(objectPath, audioFile, {
        cacheControl: '3600',
        contentType: audioFile.type || 'audio/mpeg',
        upsert: false,
      })

    if (uploadError) {
      throw uploadError
    }

    return `reference-audio:${objectPath}`
  }

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
    let resolvedReferenceAudioPath = form.referenceAudioPath.trim()

    if (selectedReferenceAudio) {
      try {
        resolvedReferenceAudioPath = await uploadReferenceAudio({
          audioFile: selectedReferenceAudio,
          schoolId: targetClass.school_id,
          fileName: selectedReferenceAudio.name,
        })
      } catch (uploadError) {
        setSubmitting(false)
        setError(
          uploadError instanceof Error ? uploadError.message : '示范音频上传失败，请稍后重试。',
        )
        return
      }
    }

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
      region_id: form.regionId || null,
      item_type: form.itemType,
      title: form.itemTitle.trim() || null,
      prompt_text: form.promptText.trim(),
      expected_text: form.expectedText.trim() || null,
      tts_text: form.ttsText.trim() || form.expectedText.trim() || null,
      reference_audio_path: resolvedReferenceAudioPath || null,
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
        itemType: form.itemType,
        itemTitle: form.itemTitle.trim() || null,
        promptText: form.promptText.trim(),
        expectedText: form.expectedText.trim() || null,
        ttsText: form.ttsText.trim() || form.expectedText.trim() || null,
        referenceAudioPath: resolvedReferenceAudioPath || null,
        regionId: form.regionId || null,
      },
      ...current,
    ])
    setClassNames((current) => ({
      ...current,
      [targetClass.id]: targetClass.name,
    }))
    setFeedback(
      resolvedReferenceAudioPath
        ? '作业和示范音频都已经创建完成，学生端会优先播放示范音频。'
        : '作业已经创建完成，下一步可以去提醒学生开始打卡。',
    )
    setSelectedReferenceAudio(null)
    setForm((current) => ({
      ...current,
      materialId: '',
      regionId: '',
      title: '',
      description: '',
      dueAt: '',
      status: 'draft',
      itemType: 'sentence',
      itemTitle: '',
      promptText: '',
      expectedText: '',
      ttsText: '',
      referenceAudioPath: '',
    }))
  }

  const currentMaterialOptions = form.classId
    ? materialOptions.filter(
        (item) =>
          item.school_id === classOptions.find((classItem) => classItem.id === form.classId)?.school_id,
      )
    : materialOptions

  const speechPreviewText =
    form.ttsText.trim() || form.expectedText.trim() || form.promptText.trim()

  const selectedRegion = materialRegionOptions.find((item) => item.id === form.regionId)

  useEffect(() => {
    setSpeechError(null)
    setSpeechPreviewBlob(null)
    setSpeechPreviewMeta(null)
    setSpeechPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current)
      }
      return null
    })
  }, [form.classId, form.ttsText, form.expectedText, form.promptText])

  useEffect(() => {
    return () => {
      if (speechPreviewUrl) {
        URL.revokeObjectURL(speechPreviewUrl)
      }
    }
  }, [speechPreviewUrl])

  const handleSpeechPreview = async () => {
    if (!form.classId) {
      setSpeechError('先选择班级，再试听语音示范。')
      return
    }

    const targetClass = classOptions.find((item) => item.id === form.classId)
    if (!targetClass) {
      setSpeechError('未找到所选班级。')
      return
    }

    if (!speechPreviewText) {
      setSpeechError('先填写 TTS 兜底文案、目标文本或提示内容，再试听示范。')
      return
    }

    setSpeechGenerating(true)
    setSpeechError(null)
    setFeedback(null)

    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        'generate-speech-sample',
        {
          body: {
            schoolId: targetClass.school_id,
            text: speechPreviewText,
          },
        },
      )

      if (invokeError) {
        throw invokeError
      }

      if (data?.error) {
        throw new Error(data.error as string)
      }

      const audioBase64 = data?.audioBase64 as string | undefined
      const mimeType = (data?.mimeType as string | undefined) ?? 'audio/mpeg'
      if (!audioBase64) {
        throw new Error('语音服务没有返回音频内容。')
      }

      const byteCharacters = atob(audioBase64)
      const bytes = Uint8Array.from(byteCharacters, (char) => char.charCodeAt(0))
      const blob = new Blob([bytes], { type: mimeType })
      const nextUrl = URL.createObjectURL(blob)

      setSpeechPreviewBlob(blob)
      setSpeechPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current)
        }
        return nextUrl
      })
      setSpeechPreviewMeta({
        providerLabel: (data?.providerLabel as string | undefined) ?? '语音模型',
        model: (data?.model as string | undefined) ?? 'unknown',
        mimeType,
        text: speechPreviewText,
        cached: Boolean(data?.cached),
        storagePath: typeof data?.storagePath === 'string' ? data.storagePath : null,
      })
    } catch (previewError) {
      console.error(previewError)
      setSpeechPreviewBlob(null)
      setSpeechPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current)
        }
        return null
      })
      setSpeechPreviewMeta(null)
      setSpeechError(
        previewError instanceof Error
          ? previewError.message
          : '语音示范生成失败，请稍后再试。',
      )
    } finally {
      setSpeechGenerating(false)
    }
  }

  const handleSavePreviewAsReferenceAudio = async () => {
    if (!speechPreviewBlob || !speechPreviewMeta) {
      setSpeechError('先生成试听语音，再保存为示范音频。')
      return
    }

    const targetClass = classOptions.find((item) => item.id === form.classId)
    if (!targetClass) {
      setSpeechError('未找到所选班级。')
      return
    }

    setSavingSpeechReference(true)
    setSpeechError(null)
    setFeedback(null)

    try {
      const referenceAudioPath = speechPreviewMeta.storagePath
        ? speechPreviewMeta.storagePath
        : await uploadReferenceAudio({
            audioFile: speechPreviewBlob,
            schoolId: targetClass.school_id,
            fileName: `generated-sample-${Date.now()}.${extensionForMimeType(
              speechPreviewMeta.mimeType,
            )}`,
          })

      setSelectedReferenceAudio(null)
      setForm((current) => ({
        ...current,
        referenceAudioPath,
      }))
      setFeedback(
        speechPreviewMeta.storagePath
          ? '已直接引用当前 AI 缓存语音，创建作业时学生端会优先播放这条示范音频。'
          : '已将当前试听语音保存为示范音频，创建作业时会直接引用这条音频。',
      )
    } catch (saveError) {
      console.error(saveError)
      setSpeechError(
        saveError instanceof Error
          ? saveError.message
          : '保存示范音频失败，请稍后再试。',
      )
    } finally {
      setSavingSpeechReference(false)
    }
  }

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
          先创建作业主记录和第一条练习内容。示范音频会优先给学生播放，没有音频时再回退到 TTS。
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
            教材热区（句子）
            <select
              value={form.regionId}
              onChange={(event) =>
                setForm((current) => ({ ...current, regionId: event.target.value }))
              }
              disabled={!form.materialId || loadingMaterialRegions}
            >
              <option value="">
                {!form.materialId
                  ? '先选择教材'
                  : loadingMaterialRegions
                    ? '正在加载教材热区...'
                    : materialRegionOptions.length === 0
                      ? '当前教材还没有标注热区'
                      : '可选：把作业绑定到具体句子'}
              </option>
              {materialRegionOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {`第 ${item.pageNumber} 页 · ${item.displayText}`}
                </option>
              ))}
            </select>
          </label>

          {selectedRegion ? (
            <div className="info-banner span-2">
              已绑定教材热区：第 {selectedRegion.pageNumber} 页
              <br />
              句子：{selectedRegion.displayText}
              <br />
              后续学生端会直接在教材页里点这句完成示范、录音和提交。
            </div>
          ) : null}

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

          <label className="span-2">
            TTS 兜底文案
            <textarea
              rows={3}
              value={form.ttsText}
              onChange={(event) =>
                setForm((current) => ({ ...current, ttsText: event.target.value }))
              }
              placeholder="如果没有上传示范音频，学生端会优先朗读这里的内容。"
            />
          </label>

          <label className="span-2">
            上传示范音频
            <input
              type="file"
              accept="audio/*"
              onChange={(event) =>
                setSelectedReferenceAudio(event.target.files?.[0] ?? null)
              }
            />
          </label>

          {selectedReferenceAudio ? (
            <div className="info-banner span-2">
              已选择示范音频：{selectedReferenceAudio.name}
              <br />
              创建作业时会自动上传，并优先给学生端播放。
            </div>
          ) : null}

          <label className="span-2">
            已有示范音频路径
            <input
              value={form.referenceAudioPath}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  referenceAudioPath: event.target.value,
                }))
              }
              placeholder="可填写 reference-audio:school-id/reference-audio/demo.mp3"
            />
          </label>

          {(form.referenceAudioPath || form.ttsText.trim()) && !selectedReferenceAudio ? (
            <div className="helper-stack span-2">
              {form.referenceAudioPath ? (
                <span className="helper-chip">已填写示范音频路径</span>
              ) : null}
              {form.ttsText.trim() ? <span className="helper-chip">已填写 TTS 兜底文案</span> : null}
            </div>
          ) : null}

          <div className="span-2 speech-preview-card">
            <div>
              <strong>试听学生端示范语音</strong>
              <p>
                会调用当前校区已配置的语音模型。学生端实际播放时，也会优先走这条远程语音链路。
              </p>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={handleSpeechPreview}
              disabled={speechGenerating || !form.classId || !speechPreviewText}
            >
              {speechGenerating ? '生成中...' : '试听远程示范'}
            </button>
          </div>

          {speechError ? <div className="error-banner span-2">{speechError}</div> : null}

          {speechPreviewMeta && speechPreviewUrl ? (
            <div className="info-banner span-2">
              当前示范来自 {speechPreviewMeta.providerLabel} / {speechPreviewMeta.model}
              <br />
              状态：
              {speechPreviewMeta.cached ? ' 已命中 AI 缓存语音' : ' 首次生成，保存后会进入 AI 缓存'}
              <br />
              文本：{speechPreviewMeta.text}
              <div className="speech-preview-player">
                <audio controls src={speechPreviewUrl}>
                  你的浏览器不支持音频预览。
                </audio>
              </div>
              <div className="speech-preview-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleSavePreviewAsReferenceAudio}
                  disabled={savingSpeechReference}
                >
                  {savingSpeechReference
                    ? '保存中...'
                    : speechPreviewMeta.storagePath
                      ? '使用当前 AI 缓存'
                      : '保存为示范音频'}
                </button>
                <span>
                  {speechPreviewMeta.storagePath
                    ? '当前试听语音已经在 `reference-audio` 里，可直接作为示范音频复用。'
                    : '保存后会写入 `reference-audio`，创建作业时直接复用。'}
                </span>
              </div>
            </div>
          ) : null}

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
                <th>示范</th>
                <th>状态</th>
                <th>提交率</th>
                <th>待处理</th>
                <th>截止时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="assignment-cell">
                      <strong>{row.title}</strong>
                      <span>{row.itemTitle || row.promptText || mapItemType(row.itemType)}</span>
                      {row.regionId ? <span>已绑定教材热区</span> : null}
                    </div>
                  </td>
                  <td>{classNames[row.class_id] || row.class_id}</td>
                  <td>
                    <div className="helper-stack">
                      {row.referenceAudioPath ? (
                        <span className="helper-chip success">
                          {row.referenceAudioPath.includes('/ai-generated-speech/')
                            ? 'AI 缓存语音'
                            : '示范音频'}
                        </span>
                      ) : null}
                      {row.ttsText ? <span className="helper-chip">TTS 兜底</span> : null}
                      {!row.referenceAudioPath && !row.ttsText ? (
                        <span className="helper-chip muted">未配置</span>
                      ) : null}
                    </div>
                  </td>
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

function mapItemType(itemType: string) {
  if (itemType === 'word') return '单词练习'
  if (itemType === 'paragraph') return '段落朗读'
  return '句子练习'
}

function mapAssignmentStatus(status: string) {
  if (status === 'published') return '已发布'
  if (status === 'closed') return '已截止'
  if (status === 'archived') return '已归档'
  return '草稿'
}

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('aac')) return 'aac'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  return 'mp3'
}
