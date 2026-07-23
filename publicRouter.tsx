import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { NotFoundRedirect } from './components/NotFoundRedirect';
import { AboutView } from './views/AboutView';
import { LandingView } from './views/LandingView';
import { LoginView, type EmailMode } from './views/LoginView';

const publicRootRoute = createRootRoute({
  notFoundComponent: NotFoundRedirect,
});

// TanStack Router's typed `navigate({ to })` is only checked against the one
// globally-registered router (see router.tsx's module augmentation, which
// registers the authenticated app router) — a second router's own paths
// aren't type-checkable through it even with an explicit generic, because
// useNavigate's *returned* function re-resolves that generic on every call.
// The router's own `history` is the documented escape hatch: plain string
// paths, no Register dependency. A push per navigation (rather than
// history.back()) keeps behaviour predictable for direct links that have no
// prior app history to go back to.
function goTo(path: '/' | '/login' | '/signup' | '/about'): void {
  publicRouter.history.push(path);
}

function LandingRouteComponent() {
  return (
    <LandingView
      onSignIn={() => goTo('/login')}
      onSignUp={() => goTo('/signup')}
      onAbout={() => goTo('/about')}
    />
  );
}

/** Shared by /login and /signup: the URL owns which form is showing. */
function AuthRouteComponent({ mode }: { mode: EmailMode }) {
  return (
    <LoginView
      mode={mode}
      onModeChange={(next) => goTo(next === 'sign-in' ? '/login' : '/signup')}
      onBack={() => goTo('/')}
    />
  );
}

const publicIndexRoute = createRoute({
  getParentRoute: () => publicRootRoute,
  path: '/',
  component: LandingRouteComponent,
});

const loginRoute = createRoute({
  getParentRoute: () => publicRootRoute,
  path: '/login',
  component: () => <AuthRouteComponent mode="sign-in" />,
});

const signupRoute = createRoute({
  getParentRoute: () => publicRootRoute,
  path: '/signup',
  component: () => <AuthRouteComponent mode="sign-up" />,
});

const aboutRoute = createRoute({
  getParentRoute: () => publicRootRoute,
  path: '/about',
  component: () => <AboutView onBack={() => goTo('/')} />,
});

const publicRouteTree = publicRootRoute.addChildren([
  publicIndexRoute,
  loginRoute,
  signupRoute,
  aboutRoute,
]);

/**
 * Router for signed-out visitors: landing page plus dedicated /login and
 * /signup URLs, so both are directly linkable and browser back/forward
 * moves between them. Mounted instead of the main app `router` (router.tsx)
 * while there's no authenticated user — see App.tsx's Gate.
 */
export const publicRouter = createRouter({ routeTree: publicRouteTree });
