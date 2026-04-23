import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type MaterialDetail = {
  id: string
  school_id: string
  title: string
  description: string | null
}

type MaterialPage = {
  id: string
  page_number: number
  image_path: string | null
  status: string
}

type MaterialRegion = {
  id: string
  material_page_id: string
  region_type: 'word' | 'sentence' | 'dialogue' | 'paragraph'
  display_text: string
  prompt_text: string | null
  expected_text: string | null
  tts_text: string | null
  x: number
  y: number
  width: number
  height: number
  sort_order: number
  status: string
}

type DraftRect = {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

const DEFAULT_FORM = {
  regionType: 'dialogue' as MaterialRegion['region_type'],
  displayText: '',
  promptText: '',
  expectedText: '',
  ttsText: '',
  sortOrder: '1',
}

export function MaterialRegionsPage() {
  const { materialId } = useParams()
  const { session } = useAuth()
  const stageRef = useRef<HTMLDivElement | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [material, setMaterial] = useState<MaterialDetail | null>(null)
  const [pages, setPages] = useState<MaterialPage[]>([])
  const [regions, setRegions] = useState<MaterialRegion[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string>('')
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null)
  const [draftRect, setDraftRect] = useState<DraftRect | null>(null)
  const [normalizedRect, setNormalizedRect] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(DEFAULT_FORM)

  useEffect(() => {
    const load = async () => {
      if (!materialId) {
        setError('缺少教材 ID。')
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      const [materialResponse, pagesResponse, regionsResponse] = await Promise.all([
        supabase
          .from('materials')
          .select('id, school_id, title, description')
          .eq('id', materialId)
          .maybeSingle(),
        supabase
          .from('material_pages')
          .select('id, page_number, image_path, status')
          .eq('material_id', materialId)
          .order('page_number', { ascending: true }),
        supabase
          .from('material_page_regions')
          .select(
            'id, material_page_id, region_type, display_text, prompt_text, expected_text, tts_text, x, y, width, height, sort_order, status',
          )
          .in('status', ['draft', 'active'])
          .order('sort_order', { ascending: true }),
      ])

      if (materialResponse.error || !materialResponse.data) {
        setError(materialResponse.error?.message ?? '没有找到这份教材。')
        setLoading(false)
        return
      }

      const pageRows = (pagesResponse.data ?? []) as MaterialPage[]
      const allRegions = (regionsResponse.data ?? []) as MaterialRegion[]
      const filteredRegions = allRegions.filter((item) =>
        pageRows.some((page) => page.id === item.material_page_id),
      )

      setMaterial(materialResponse.data as MaterialDetail)
      setPages(pageRows)
      setRegions(filteredRegions)
      setSelectedPageId((current) => current || pageRows[0]?.id || '')
      setSelectedRegionId(null)
      setLoading(false)
    }

    void load()
  }, [materialId])

  useEffect(() => {
    const resolvePageImage = async () => {
      const selectedPage = pages.find((page) => page.id === selectedPageId)
      if (!selectedPage?.image_path) {
        setPageImageUrl(null)
        return
      }

      const imagePath = selectedPage.image_path
      if (imagePath.startsWith('asset:')) {
        const assetPath = imagePath.replace('asset:assets/', '')
        setPageImageUrl(`/${assetPath}`)
        return
      }

      if (/^https?:\/\//.test(imagePath)) {
        setPageImageUrl(imagePath)
        return
      }

      const { data, error: signedUrlError } = await supabase.storage
        .from('material-pages')
        .createSignedUrl(imagePath, 3600)

      if (signedUrlError || !data?.signedUrl) {
        setPageImageUrl(null)
        return
      }

      setPageImageUrl(data.signedUrl)
    }

    void resolvePageImage()
  }, [pages, selectedPageId])

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? null,
    [pages, selectedPageId],
  )

  const selectedRegion = useMemo(
    () => regions.find((region) => region.id === selectedRegionId) ?? null,
    [regions, selectedRegionId],
  )

  const pageRegions = useMemo(
    () =>
      regions
        .filter((item) => item.material_page_id === selectedPageId)
        .sort((left, right) => left.sort_order - right.sort_order),
    [regions, selectedPageId],
  )

  useEffect(() => {
    if (!selectedRegionId) {
      return
    }
    const stillExistsOnPage = pageRegions.some((region) => region.id === selectedRegionId)
    if (!stillExistsOnPage) {
      setSelectedRegionId(null)
    }
  }, [pageRegions, selectedRegionId])

  const handleStageMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!stageRef.current) {
      return
    }
    const bounds = stageRef.current.getBoundingClientRect()
    const offsetX = event.clientX - bounds.left
    const offsetY = event.clientY - bounds.top
    setDraftRect({
      startX: offsetX,
      startY: offsetY,
      currentX: offsetX,
      currentY: offsetY,
    })
    setSelectedRegionId(null)
    setNormalizedRect(null)
  }

  const handleStageMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!draftRect || !stageRef.current) {
      return
    }
    const bounds = stageRef.current.getBoundingClientRect()
    const offsetX = event.clientX - bounds.left
    const offsetY = event.clientY - bounds.top
    setDraftRect((current) =>
      current
        ? {
            ...current,
            currentX: offsetX,
            currentY: offsetY,
          }
        : null,
    )
  }

  const handleStageMouseUp = () => {
    if (!draftRect || !stageRef.current) {
      return
    }
    const bounds = stageRef.current.getBoundingClientRect()
    const left = Math.min(draftRect.startX, draftRect.currentX)
    const top = Math.min(draftRect.startY, draftRect.currentY)
    const width = Math.abs(draftRect.currentX - draftRect.startX)
    const height = Math.abs(draftRect.currentY - draftRect.startY)

    setDraftRect(null)

    if (width < 16 || height < 16) {
      return
    }

    setNormalizedRect({
      x: Number((left / bounds.width).toFixed(5)),
      y: Number((top / bounds.height).toFixed(5)),
      width: Number((width / bounds.width).toFixed(5)),
      height: Number((height / bounds.height).toFixed(5)),
    })
    setFeedback('热区框选好了，补充句子内容后就能保存。')
  }

  const handleSaveRegion = async () => {
    if (!session?.user || !selectedPageId || !normalizedRect) {
      setError('请先选中教材页并框选一句区域。')
      return
    }

    if (!form.displayText.trim()) {
      setError('请先填写这句显示文本。')
      return
    }

    setSaving(true)
    setError(null)
    setFeedback(null)

    const payload = {
      material_page_id: selectedPageId,
      region_type: form.regionType,
      sort_order: Number(form.sortOrder) || pageRegions.length + 1,
      x: normalizedRect.x,
      y: normalizedRect.y,
      width: normalizedRect.width,
      height: normalizedRect.height,
      display_text: form.displayText.trim(),
      prompt_text: form.promptText.trim() || null,
      expected_text: form.expectedText.trim() || form.displayText.trim(),
      tts_text: form.ttsText.trim() || form.expectedText.trim() || form.displayText.trim(),
      status: 'active',
    }

    const query = selectedRegionId
      ? supabase
          .from('material_page_regions')
          .update(payload)
          .eq('id', selectedRegionId)
          .select(
            'id, material_page_id, region_type, display_text, prompt_text, expected_text, tts_text, x, y, width, height, sort_order, status',
          )
          .single()
      : supabase
          .from('material_page_regions')
          .insert({
            ...payload,
            created_by: session.user.id,
          })
          .select(
            'id, material_page_id, region_type, display_text, prompt_text, expected_text, tts_text, x, y, width, height, sort_order, status',
          )
          .single()

    const { data, error: saveError } = await query

    setSaving(false)

    if (saveError || !data) {
      setError(saveError?.message ?? '保存热区失败。')
      return
    }

    setRegions((current) => {
      const nextRegion = data as MaterialRegion
      if (selectedRegionId) {
        return current.map((item) => (item.id === selectedRegionId ? nextRegion : item))
      }
      return [...current, nextRegion]
    })
    setSelectedRegionId((data as MaterialRegion).id)
    setNormalizedRect(null)
    setForm((current) => ({
      ...DEFAULT_FORM,
      sortOrder: String((Number(current.sortOrder) || pageRegions.length + 1) + 1),
    }))
    setFeedback(
      selectedRegionId
        ? '这句热区已经更新，教师端创建作业时会自动用最新内容。'
        : '句子热区已经保存，后面创建作业时就能直接选这句了。',
    )
  }

  const handleSelectRegion = (region: MaterialRegion) => {
    setSelectedRegionId(region.id)
    setNormalizedRect({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    })
    setForm({
      regionType: region.region_type,
      displayText: region.display_text,
      promptText: region.prompt_text ?? '',
      expectedText: region.expected_text ?? '',
      ttsText: region.tts_text ?? '',
      sortOrder: String(region.sort_order),
    })
    setFeedback('正在预览这句热区，可以直接改内容或重新拖框。')
    setError(null)
  }

  const handleCreateNew = () => {
    setSelectedRegionId(null)
    setNormalizedRect(null)
    setDraftRect(null)
    setForm({
      ...DEFAULT_FORM,
      sortOrder: String(pageRegions.length + 1),
    })
    setFeedback('已切换到新增模式，先在图片上框一句新的内容。')
    setError(null)
  }

  const handleArchiveRegion = async () => {
    if (!selectedRegionId) {
      setError('先选中一条热区，再删除。')
      return
    }

    setSaving(true)
    setError(null)
    setFeedback(null)

    const { error: archiveError } = await supabase
      .from('material_page_regions')
      .update({ status: 'archived' })
      .eq('id', selectedRegionId)

    setSaving(false)

    if (archiveError) {
      setError(archiveError.message ?? '删除热区失败。')
      return
    }

    setRegions((current) => current.filter((item) => item.id !== selectedRegionId))
    setSelectedRegionId(null)
    setNormalizedRect(null)
    setDraftRect(null)
    setForm({
      ...DEFAULT_FORM,
      sortOrder: String(Math.max(1, pageRegions.length - 1)),
    })
    setFeedback('这句热区已经移除。')
  }

  if (loading) {
    return <div className="screen-state">正在加载教材热区标注页...</div>
  }

  if (!material) {
    return (
      <section className="page">
        <div className="error-banner">没有找到这份教材。</div>
      </section>
    )
  }

  const draftStyle =
    draftRect && stageRef.current
      ? {
          left: Math.min(draftRect.startX, draftRect.currentX),
          top: Math.min(draftRect.startY, draftRect.currentY),
          width: Math.abs(draftRect.currentX - draftRect.startX),
          height: Math.abs(draftRect.currentY - draftRect.startY),
        }
      : null

  return (
    <section className="page">
      <header className="page-header compact">
        <div>
          <span className="eyebrow">Region Editor</span>
          <h1>教材热区标注</h1>
          <p>{material.title}</p>
        </div>
        <Link className="ghost-button region-back-button" to="/materials">
          返回教材资源
        </Link>
      </header>

      <div className="region-editor-layout">
        <article className="panel region-stage-panel">
          <div className="panel-heading">
            <div>
              <h2>教材页框选</h2>
              <p className="panel-copy">点页码切换，再在图片上拖拽框出一句英文对话。</p>
            </div>
            <div className="helper-stack">
              {pages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className={`filter-chip${page.id === selectedPageId ? ' active' : ''}`}
                  onClick={() => {
                    setSelectedPageId(page.id)
                    setNormalizedRect(null)
                    setDraftRect(null)
                    setSelectedRegionId(null)
                  }}
                >
                  第 {page.page_number} 页
                </button>
              ))}
            </div>
          </div>

          <div className="region-stage-shell">
            <div
              ref={stageRef}
              className="region-stage"
              onMouseDown={pageImageUrl ? handleStageMouseDown : undefined}
              onMouseMove={pageImageUrl ? handleStageMouseMove : undefined}
              onMouseUp={pageImageUrl ? handleStageMouseUp : undefined}
              onMouseLeave={draftRect ? handleStageMouseUp : undefined}
            >
              {pageImageUrl ? (
                <img className="region-stage-image" src={pageImageUrl} alt={selectedPage?.page_number ? `第 ${selectedPage.page_number} 页` : '教材页'} />
              ) : (
                <div className="empty-state region-stage-empty">
                  当前页还没有图片。先上传页图到 <code>material-pages</code> bucket，或像试点页一样给这页配一个图片资源。
                </div>
              )}

                {pageRegions.map((region, index) => (
                  <button
                    key={region.id}
                    type="button"
                    className={`region-overlay${region.id === selectedRegionId ? ' region-overlay-selected' : ''}`}
                    style={{
                      left: `${region.x * 100}%`,
                      top: `${region.y * 100}%`,
                      width: `${region.width * 100}%`,
                      height: `${region.height * 100}%`,
                    }}
                    title={region.display_text}
                    onClick={() => handleSelectRegion(region)}
                  >
                    <span>{index + 1}</span>
                  </button>
                ))}

              {draftStyle ? <div className="region-draft" style={draftStyle} /> : null}
            </div>
          </div>

          {normalizedRect ? (
            <div className="info-banner">
              当前热区：x {normalizedRect.x} / y {normalizedRect.y} / 宽 {normalizedRect.width} / 高 {normalizedRect.height}
            </div>
          ) : (
            <div className="panel-copy">先在图片上拖出一个句子区域，再到右侧填写内容。</div>
          )}
        </article>

        <aside className="region-side-panel">
          <article className="panel">
            <h2>保存当前句子</h2>
            {selectedRegion ? (
              <div className="info-banner">
                正在预览：第 {selectedPage?.page_number ?? '-'} 页第 {selectedRegion.sort_order} 句
              </div>
            ) : null}
            {selectedRegion ? <div style={{ height: 12 }} /> : null}
            <div className="inline-form region-form">
              <label>
                热区类型
                <select
                  value={form.regionType}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      regionType: event.target.value as MaterialRegion['region_type'],
                    }))
                  }
                >
                  <option value="dialogue">dialogue</option>
                  <option value="sentence">sentence</option>
                  <option value="word">word</option>
                  <option value="paragraph">paragraph</option>
                </select>
              </label>

              <label>
                排序
                <input
                  type="number"
                  min="1"
                  value={form.sortOrder}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                />
              </label>

              <label className="span-2">
                这句显示文本
                <textarea
                  rows={3}
                  value={form.displayText}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, displayText: event.target.value }))
                  }
                  placeholder="例如：Good morning! I'm Miss Wu. What's your name?"
                />
              </label>

              <label className="span-2">
                学生提示
                <textarea
                  rows={2}
                  value={form.promptText}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, promptText: event.target.value }))
                  }
                  placeholder="例如：先听老师问候，再读出 Miss Wu 的问题。"
                />
              </label>

              <label className="span-2">
                目标文本
                <textarea
                  rows={2}
                  value={form.expectedText}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, expectedText: event.target.value }))
                  }
                  placeholder="一般直接填英文原句。"
                />
              </label>

              <label className="span-2">
                TTS 兜底文案
                <textarea
                  rows={2}
                  value={form.ttsText}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, ttsText: event.target.value }))
                  }
                  placeholder="不填则默认和目标文本一致。"
                />
              </label>

              {error ? <div className="error-banner span-2">{error}</div> : null}
              {feedback ? <div className="success-banner span-2">{feedback}</div> : null}

              <div className="form-actions span-2">
                <button
                  className="ghost-button"
                  type="button"
                  disabled={saving}
                  onClick={handleCreateNew}
                >
                  新建热区
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={saving || !normalizedRect}
                  onClick={() => void handleSaveRegion()}
                >
                  {saving ? '保存中...' : selectedRegionId ? '更新这句热区' : '保存这句热区'}
                </button>
                {selectedRegionId ? (
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={saving}
                    onClick={() => void handleArchiveRegion()}
                  >
                    删除这句热区
                  </button>
                ) : null}
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <h2>当前页已有句子</h2>
                <p className="panel-copy">先做少量高频句子，后面再继续扩页。</p>
              </div>
            </div>
            {pageRegions.length === 0 ? (
              <div className="empty-inline">这一页还没有热区，先框出第一句吧。</div>
            ) : (
              <div className="region-list">
                {pageRegions.map((region, index) => (
                  <article
                    key={region.id}
                    className={`region-list-item${region.id === selectedRegionId ? ' region-list-item-selected' : ''}`}
                    onClick={() => handleSelectRegion(region)}
                  >
                    <strong>
                      {index + 1}. {region.display_text}
                    </strong>
                    <span>
                      {region.region_type} · x {region.x} / y {region.y} / 宽 {region.width} / 高 {region.height}
                    </span>
                    {region.prompt_text ? <p>{region.prompt_text}</p> : null}
                  </article>
                ))}
              </div>
            )}
          </article>
        </aside>
      </div>
    </section>
  )
}
