import { useI18n } from '../lib/i18n'

const RADIUS = 22
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * How far along today is, and the household's streak - the top of the Today
 * screen. "Taken care of" counts a skip as well as a completion, the same way
 * the done section does: a skipped task is settled for the day too.
 */
export function TodayProgress({ handled, total, streak }: { handled: number; total: number; streak: number | null }) {
  const { t } = useI18n()
  const left = total - handled
  const share = total > 0 ? handled / total : 0
  const details = [left > 0 ? t.today.progressLeft(left) : t.today.progressDone]
  // One day is not a streak yet.
  if (streak !== null && streak >= 2) details.push(t.today.streak(streak))

  return (
    <section className="today-progress">
      <svg className="today-progress-ring" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r={RADIUS} fill="none" className="today-progress-track" strokeWidth="7" />
        <circle
          cx="28"
          cy="28"
          r={RADIUS}
          fill="none"
          className="today-progress-fill"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - share)}
          transform="rotate(-90 28 28)"
        />
        <text x="28" y="33" textAnchor="middle" direction="ltr" className="today-progress-count">
          {`${handled}/${total}`}
        </text>
      </svg>
      <div className="today-progress-text">
        <p className="today-progress-title">{t.today.progress(handled, total)}</p>
        <p className="today-progress-details">{details.join(' · ')}</p>
      </div>
    </section>
  )
}
