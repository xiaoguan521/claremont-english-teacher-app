import { useEffect, useState } from 'react'

import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type ClassRow = {
  id: string
  name: string
  grade_label: string | null
  academic_year: string | null
  status: string
}

export function ClassesPage() {
  const { memberships } = useAuth()
  const [rows, setRows] = useState<ClassRow[]>([])

  useEffect(() => {
    const load = async () => {
      const schoolIds = Array.from(new Set(memberships.map((item) => item.school_id)))
      const classIds = Array.from(
        new Set(memberships.map((item) => item.class_id).filter(Boolean) as string[]),
      )
      const canViewWholeSchool = memberships.some(
        (item) => item.role === 'school_admin' && item.class_id === null,
      )

      const query =
        canViewWholeSchool || classIds.length === 0
          ? supabase.from('classes').select('id, name, grade_label, academic_year, status').in('school_id', schoolIds)
          : supabase.from('classes').select('id, name, grade_label, academic_year, status').in('id', classIds)

      const { data, error } = await query.order('created_at', { ascending: false })
      if (!error) {
        setRows((data ?? []) as ClassRow[])
      }
    }

    void load()
  }, [memberships])

  return (
    <section className="page">
      <header className="page-header compact">
        <div>
          <span className="eyebrow">Classes</span>
          <h1>班级管理</h1>
        </div>
      </header>
      <DataTable
        columns={['班级', '年级', '学年', '状态']}
        rows={rows.map((row) => [
          row.name,
          row.grade_label || '-',
          row.academic_year || '-',
          row.status,
        ])}
        emptyMessage="当前账号下还没有可见班级。"
      />
    </section>
  )
}

function DataTable({
  columns,
  rows,
  emptyMessage,
}: {
  columns: string[]
  rows: string[][]
  emptyMessage: string
}) {
  if (rows.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>
  }

  return (
    <div className="table-card">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join('-')}>
              {row.map((value) => (
                <td key={value}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
