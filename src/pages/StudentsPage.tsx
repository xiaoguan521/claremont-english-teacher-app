import { useEffect, useState } from 'react'

import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type StudentMembership = {
  user_id: string
  class_id: string | null
}

type StudentProfile = {
  id: string
  display_name: string
  phone: string | null
}

export function StudentsPage() {
  const { memberships } = useAuth()
  const [rows, setRows] = useState<Array<{ name: string; phone: string; classId: string }>>([])

  useEffect(() => {
    const load = async () => {
      const schoolIds = Array.from(new Set(memberships.map((item) => item.school_id)))
      const classIds = Array.from(
        new Set(memberships.map((item) => item.class_id).filter(Boolean) as string[]),
      )
      const canViewWholeSchool = memberships.some(
        (item) => item.role === 'school_admin' && item.class_id === null,
      )

      const studentQuery =
        canViewWholeSchool || classIds.length === 0
          ? supabase
              .from('memberships')
              .select('user_id, class_id')
              .in('school_id', schoolIds)
              .eq('role', 'student')
              .eq('status', 'active')
          : supabase
              .from('memberships')
              .select('user_id, class_id')
              .in('class_id', classIds)
              .eq('role', 'student')
              .eq('status', 'active')

      const { data: studentMemberships, error } = await studentQuery

      if (error || !studentMemberships?.length) {
        setRows([])
        return
      }

      const userIds = Array.from(
        new Set(studentMemberships.map((item) => item.user_id).filter(Boolean)),
      )

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, phone')
        .in('id', userIds)

      const profileMap = new Map<string, StudentProfile>(
        ((profiles ?? []) as StudentProfile[]).map((item) => [item.id, item]),
      )

      setRows(
        (studentMemberships as StudentMembership[]).map((item) => {
          const profile = profileMap.get(item.user_id)
          return {
            name: profile?.display_name || item.user_id,
            phone: profile?.phone || '-',
            classId: item.class_id || '未分班',
          }
        }),
      )
    }

    void load()
  }, [memberships])

  return (
    <section className="page">
      <header className="page-header compact">
        <div>
          <span className="eyebrow">Students</span>
          <h1>学员管理</h1>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="empty-state">当前还没有学员数据。</div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>电话</th>
                <th>班级 ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.name}-${row.classId}`}>
                  <td>{row.name}</td>
                  <td>{row.phone}</td>
                  <td>{row.classId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
