import { createFileRoute } from '@tanstack/react-router'
import { PostPage } from '../ui'
export const Route = createFileRoute('/post')({ component: PostPage })
