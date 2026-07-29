import { type ComponentType, lazy, type ReactNode, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';
import { ToastProvider } from './components/feedback/Toast';
import { CREATE_ACCOUNT_PATH, SIGN_IN_PATH } from './lib/routes';
import { AuthProvider, useAuth } from './providers/auth';
import { useWorkspace, WorkspaceProvider } from './providers/workspace';

// Route components are named exports, but lazy() wants a module whose default is
// the component. This adapts each dynamic import so the call sites stay one line.
const lazyRoute = <M extends Record<K, ComponentType>, K extends string>(
  load: () => Promise<M>,
  name: K,
) => lazy(() => load().then((m) => ({ default: m[name] })));

const Dash = lazyRoute(() => import('./components/layout/Dash'), 'Dash');
const Account = lazyRoute(() => import('./pages/Account'), 'Account');
const Auth = lazyRoute(() => import('./pages/Auth'), 'Auth');
const Competitors = lazyRoute(
  () => import('./pages/Competitors'),
  'Competitors',
);
const Help = lazyRoute(() => import('./pages/Help'), 'Help');
const Home = lazyRoute(() => import('./pages/Home'), 'Home');
const Glossary = lazyRoute(() => import('./pages/Help'), 'Glossary');
const McpGuide = lazyRoute(() => import('./pages/Help'), 'McpGuide');
const Onboarding = lazyRoute(() => import('./pages/Onboarding'), 'Onboarding');
const Overview = lazyRoute(() => import('./pages/Overview'), 'Overview');
const Prompts = lazyRoute(() => import('./pages/Prompts'), 'Prompts');
const RunDetail = lazyRoute(() => import('./pages/Runs'), 'RunDetail');
const Runs = lazyRoute(() => import('./pages/Runs'), 'Runs');
const Settings = lazyRoute(() => import('./pages/Settings'), 'Settings');
const Sources = lazyRoute(() => import('./pages/Sources'), 'Sources');

const RouteFallback = () => (
  <div
    className="flex min-h-dvh w-full items-center justify-center bg-bg"
    role="status"
  >
    <div className="route-fallback-content flex flex-col items-center gap-2.5">
      <div
        className="relative h-4 w-28 overflow-hidden border-border border-x"
        aria-hidden
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        <div className="route-fallback-scan absolute inset-y-0 w-12" />
      </div>
      <span className="font-mono text-[10px] text-muted uppercase tracking-[0.12em]">
        loading
      </span>
    </div>
  </div>
);

const suspended = (node: ReactNode) => (
  <Suspense fallback={<RouteFallback />}>{node}</Suspense>
);

const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { email, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!email) {
    return <Navigate to={SIGN_IN_PATH} replace />;
  }

  return <WorkspaceProvider>{children}</WorkspaceProvider>;
};

// Data routes must not render before the workspace prefix is known.
const RequireWorkspaceReady = ({ children }: { children: ReactNode }) => {
  const { loading } = useWorkspace();

  if (loading) {
    return null;
  }

  return children;
};

// Signed-in shell: auth + workspace context shared by onboarding and the dashboard.
const AuthedShell = () => (
  <RequireAuth>
    <RequireWorkspaceReady>
      <Outlet />
    </RequireWorkspaceReady>
  </RequireAuth>
);

// A workspace that hasn't finished the wizard is not set up — send it to
// onboarding, which resumes at the last step.
const RequireOnboarded = ({ children }: { children: ReactNode }) => {
  const { current } = useWorkspace();

  if (!current?.onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
};

export const App = () => (
  <ToastProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* The public landing lives on the website Worker (refd.ai); the
              dashboard root goes straight to the app. */}
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path={SIGN_IN_PATH} element={suspended(<Auth />)} />
          <Route path={CREATE_ACCOUNT_PATH} element={suspended(<Auth />)} />
          <Route
            path="/auth"
            element={<Navigate to={SIGN_IN_PATH} replace />}
          />
          <Route
            path="/login"
            element={<Navigate to={SIGN_IN_PATH} replace />}
          />
          <Route element={<AuthedShell />}>
            <Route path="/onboarding" element={suspended(<Onboarding />)} />
            <Route
              element={
                <RequireOnboarded>{suspended(<Dash />)}</RequireOnboarded>
              }
            >
              <Route path="/home" element={suspended(<Home />)} />
              <Route path="/home/:chatId" element={suspended(<Home />)} />
              <Route path="/overview" element={suspended(<Overview />)} />
              <Route path="/prompts" element={suspended(<Prompts />)} />
              <Route path="/sources" element={suspended(<Sources />)} />
              <Route path="/competitors" element={suspended(<Competitors />)} />
              <Route path="/runs" element={suspended(<Runs />)} />
              <Route path="/runs/:id" element={suspended(<RunDetail />)} />
              <Route path="/help" element={suspended(<Help />)}>
                <Route index element={<Navigate to="glossary" replace />} />
                <Route path="glossary" element={suspended(<Glossary />)} />
                <Route path="mcp" element={suspended(<McpGuide />)} />
              </Route>
              <Route path="/settings" element={suspended(<Settings />)} />
              <Route path="/account" element={suspended(<Account />)} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </ToastProvider>
);
