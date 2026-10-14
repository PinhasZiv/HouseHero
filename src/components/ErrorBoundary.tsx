import { Component, type ReactNode } from 'react'
import { t } from '../lib/i18n'
import { HouseMark } from './Icons'

/**
 * The last line of defence against a blank screen: whatever throws while
 * rendering - most likely a screen's file that failed to load - gets a way
 * back instead of an empty page. A load failure first tries one automatic
 * reload (see index.html); this is what shows if that is not enough.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('render failed', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    const strings = t()
    return (
      <div className="centered-page">
        <HouseMark size={48} />
        <h2>{strings.common.somethingWrong}</h2>
        <p className="muted">{strings.common.crashBody}</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          {strings.common.reload}
        </button>
      </div>
    )
  }
}
