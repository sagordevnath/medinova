import { Suspense, lazy } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { App } from './App';
import { HomePage } from './pages/HomePage';
import { PageTransition } from './components/PageTransition';
import { ProtectedRoute } from './components/ProtectedRoute';

const BranchesPage = lazy(() => import('./pages/BranchesPage').then((m) => ({ default: m.BranchesPage })));
const DoctorsPage = lazy(() => import('./pages/DoctorsPage').then((m) => ({ default: m.DoctorsPage })));
const DoctorProfilePage = lazy(() => import('./pages/DoctorProfilePage').then((m) => ({ default: m.DoctorProfilePage })));
const BookPage = lazy(() => import('./pages/BookPage').then((m) => ({ default: m.BookPage })));
const DesignSystemPage = lazy(() => import('./pages/DesignSystemPage').then((m) => ({ default: m.DesignSystemPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const OfflinePage = lazy(() => import('./pages/OfflinePage').then((m) => ({ default: m.OfflinePage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const DashboardsPage = lazy(() => import('./pages/DashboardsPage').then((m) => ({ default: m.DashboardsPage })));
const DoctorWorkspacePage = lazy(() => import('./pages/DoctorWorkspacePage').then((m) => ({ default: m.DoctorWorkspacePage })));
const StaffWorkspacePage = lazy(() => import('./pages/StaffWorkspacePage').then((m) => ({ default: m.StaffWorkspacePage })));
const AdminWorkspacePage = lazy(() => import('./pages/AdminWorkspacePage').then((m) => ({ default: m.AdminWorkspacePage })));

function fallback() {
  return (
    <PageTransition>
      <p role="status">Loading…</p>
    </PageTransition>
  );
}

const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    errorElement: (
      <Suspense fallback={fallback()}>
        <NotFoundPage />
      </Suspense>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'branches', element: <Suspense fallback={fallback()}><BranchesPage /></Suspense> },
      { path: 'doctors', element: <Suspense fallback={fallback()}><DoctorsPage /></Suspense> },
      { path: 'doctors/:slug', element: <Suspense fallback={fallback()}><DoctorProfilePage /></Suspense> },
      { path: 'departments', element: <Suspense fallback={fallback()}><DoctorsPage /></Suspense> },
      { path: 'book', element: <Suspense fallback={fallback()}><BookPage /></Suspense> },
      { path: 'login', element: <Suspense fallback={fallback()}><LoginPage /></Suspense> },
      { path: 'register', element: <Suspense fallback={fallback()}><RegisterPage /></Suspense> },
      { path: 'forgot-password', element: <Suspense fallback={fallback()}><ForgotPasswordPage /></Suspense> },
      { path: 'reset-password', element: <Suspense fallback={fallback()}><ResetPasswordPage /></Suspense> },
      { path: 'account', element: <ProtectedRoute roles={['patient']}><Suspense fallback={fallback()}><DashboardsPage /></Suspense></ProtectedRoute> },
      { path: 'doctor', element: <ProtectedRoute roles={['doctor']}><Suspense fallback={fallback()}><DoctorWorkspacePage /></Suspense></ProtectedRoute> },
      { path: 'reception', element: <ProtectedRoute roles={['receptionist']}><Suspense fallback={fallback()}><StaffWorkspacePage mode="reception" /></Suspense></ProtectedRoute> },
      { path: 'branch-admin', element: <ProtectedRoute roles={['branch_admin']}><Suspense fallback={fallback()}><StaffWorkspacePage mode="admin" /></Suspense></ProtectedRoute> },
      { path: 'display/:branchSlug', element: <Suspense fallback={fallback()}><StaffWorkspacePage mode="display" /></Suspense> },
      { path: 'admin', element: <ProtectedRoute roles={['super_admin']}><Suspense fallback={fallback()}><AdminWorkspacePage /></Suspense></ProtectedRoute> },
      { path: 'design-system', element: <Suspense fallback={fallback()}><DesignSystemPage /></Suspense> },
      { path: 'offline', element: <Suspense fallback={fallback()}><OfflinePage /></Suspense> },
      { path: '*', element: <Suspense fallback={fallback()}><NotFoundPage /></Suspense> },
    ],
  },
];

export const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter(routes);



