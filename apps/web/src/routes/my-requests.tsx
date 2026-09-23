import { createFileRoute } from '@tanstack/react-router'
import { MyRequests } from '../ui'
export const Route = createFileRoute('/my-requests')({ component: MyRequests })
