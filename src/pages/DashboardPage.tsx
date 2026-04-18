import { useEffect, useState } from 'react'

import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type Summary = {
  classes: number
  students: number
  assignments: number
  materials: number
}

export function DashboardPage() {
  const { memberships } = useAuth()
  const [summary, setSummary] = useState<Summary>({
    classes: 0,
    students: 0,
    assignments: 0,
    materials: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)

      const schoolIds = Array.from(new Set(memberships.map((item) => item.school_id)))
      const classIds = Array.from(
        new Set(memberships.map((item) => item.class_id).filter(Boolean) as string[]),
      )

      const canViewWholeSchool = memberships.some(
        (item) => item.role === 'school_admin' && item.class_id === null,
      )

      const classScope =
        canViewWholeSchool || classIds.length === 0
          ? await supabase
              .from('classes')
              .select('id', { count: 'exact' })
              .in('school_id', schoolIds)
              .eq('status', 'active')
          : await supabase
              .from('classes')
              .select('id', { count: 'exact' })
              .in('id', classIds)
              .eq('status', 'active')

      const assignmentsScope =
        canViewWholeSchool || classIds.length === 0
          ? await supabase
              .from('assignments')
              .select('id', { count: 'exact' })
              .in('school_id', schoolIds)
          : await supabase
              .from('assignments')
              .select('id', { count: 'exact' })
              .in('class_id', classIds)

      const materialsScope = await supabase
        .from('materials')
        .select('id', { count: 'exact' })
        .in('school_id', schoolIds)

      const studentsScope =
        canViewWholeSchool || classIds.length === 0
          ? await supabase
              .from('memberships')
              .select('id', { count: 'exact' })
              .in('school_id', schoolIds)
              .eq('role', 'student')
              .eq('status', 'active')
          : await supabase
              .from('memberships')
              .select('id', { count: 'exact' })
              .in('class_id', classIds)
              .eq('role', 'student')
              .eq('status', 'active')

      setSummary({
        classes: classScope.count ?? 0,
        students: studentsScope.count ?? 0,
        assignments: assignmentsScope.count ?? 0,
        materials: materialsScope.count ?? 0,
      })
      setLoading(false)
    }

    void load()
  }, [memberships])

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">今日概览</span>
          <h1>教师工作台</h1>
          <p>今天先用真实数据把班级、教材和作业管理链路跑通。</p>
        </div>
      </header>

      <div className="stat-grid">
        <StatCard title="班级数" value={loading ? '...' : String(summary.classes)} />
        <StatCard title="学员数" value={loading ? '...' : String(summary.students)} />
        <StatCard title="作业数" value={loading ? '...' : String(summary.assignments)} />
        <StatCard title="教材数" value={loading ? '...' : String(summary.materials)} />
      </div>

      <div className="content-grid">
        <Panel
          title="今日工作重点"
          items={[
            '核对班级与学生绑定是否正确。',
            '继续补教材上传和作业布置表单。',
            '明天再做更细的业务流程和交互优化。',
          ]}
        />
        <Panel
          title="当前已接入能力"
          items={[
            'Supabase 登录与会话保持',
            '教师/管理员权限识别',
            '班级、学员、作业、教材四个常用页',
          ]}
        />
      </div>
    </section>
  )
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <article className="stat-card">
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  )
}

function Panel({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="panel">
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  )
}
