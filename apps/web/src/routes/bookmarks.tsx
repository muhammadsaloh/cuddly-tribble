import { createFileRoute } from '@tanstack/react-router'
import { Bookmarks } from '../ui'
export const Route = createFileRoute('/bookmarks')({ component: Bookmarks })
