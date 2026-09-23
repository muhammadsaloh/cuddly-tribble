import { Link, createRootRoute, Outlet } from '@tanstack/react-router'
import { AppShell } from '../ui'
export const Route = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  notFoundComponent: () => (
    <div className="route-state">
      <h1>Page not found</h1>
      <p>The page you’re looking for is unavailable.</p>
      <Link to="/" className="primary-button">
        Back to market
      </Link>
    </div>
  ),
  errorComponent: ({ reset }) => (
    <div className="route-state">
      <h1>Something went wrong</h1>
      <p>Please try loading this page again.</p>
      <button className="primary-button" onClick={reset}>
        Try again
      </button>
    </div>
  ),
})
