import { createFileRoute } from '@tanstack/react-router'
import { Messages } from '../ui'
export const Route = createFileRoute('/messages')({ component: Messages })
