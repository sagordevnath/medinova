import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Role } from '@medinova/shared';
import { ROLE_DASHBOARD } from '@medinova/shared';
import { useAuth } from '../hooks/useAuth';

interface ProtectedRouteProps {
  children: ReactNode;
  /** When set, only these roles may enter; others are redirected to their dashboard. */
  roles?: readonly Role[];
}

/** Route guard: requires a signed-in user (and optionally one of `roles`). */
export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { session, role, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-bg grid place-items-center" role="status" aria-label="loading">
        <div className="h-9 w-9 rounded-full border-2 border-line border-t-accent animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }

  if (!role) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !roles.includes(role)) {
    return <Navigate to={ROLE_DASHBOARD[role]} replace />;
  }

  return <>{children}</>;
}