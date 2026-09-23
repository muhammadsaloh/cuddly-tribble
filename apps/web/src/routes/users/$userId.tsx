import { createFileRoute } from '@tanstack/react-router'
import { ColleagueProfile } from '../../ui'

export const Route = createFileRoute('/users/$userId')({ component: ColleagueProfile })
