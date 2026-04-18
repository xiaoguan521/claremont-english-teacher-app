import { NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '../lib/auth'

const navigation = [
  { to: '/', label: '工作台' },
  { to: '/classes', label: '班级管理' },
  { to: '/students', label: '学员管理' },
  { to: '/assignments', label: '作业中心' },
  { to: '/materials', label: '教材资源' },
]

export function AppShell() {
  const { profile, session, signOut } = useAuth()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-mark">CE</div>
          <div>
            <div className="brand-title">克莱蒙英语教师端</div>
            <div className="brand-subtitle">Teacher Workspace</div>
          </div>
        </div>

        <nav className="nav-list">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `nav-item${isActive ? ' nav-item-active' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <strong>{profile?.display_name || '教师账号'}</strong>
            <span>{session?.user.email}</span>
          </div>
          <button className="ghost-button" onClick={() => void signOut()}>
            退出登录
          </button>
        </div>
      </aside>

      <main className="page-container">
        <Outlet />
      </main>
    </div>
  )
}
