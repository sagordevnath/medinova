import { useContext } from 'react';
import { AuthContext } from '../providers/AuthProvider';

/** Access the auth session, role profile and auth actions. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}