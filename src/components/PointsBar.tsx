import { useI18n } from '../lib/i18n'
import { StarIcon } from './Icons'

interface PointsBarProps {
  lifetime: number
  spendable: number
  /** Bumps a brief pop animation - set to a changing key (e.g. the value
   * itself) right after points are earned. */
  celebrate?: boolean
}

/** The two numbers every screen that touches points shows the same way. */
export function PointsBar({ lifetime, spendable, celebrate }: PointsBarProps) {
  const { t } = useI18n()
  return (
    <div className="points-bar">
      <div className="points-tile">
        <span className="points-value">{lifetime}</span>
        <span className="points-label">
          <StarIcon size={12} /> {t.points.lifetime}
        </span>
      </div>
      <div className={`points-tile points-tile-spendable ${celebrate ? 'points-pop' : ''}`}>
        <span className="points-value">{spendable}</span>
        <span className="points-label">{t.points.spendable}</span>
      </div>
    </div>
  )
}
