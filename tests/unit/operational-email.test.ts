import { describe, expect, it } from 'vitest'
import { buildOperationalEmailHtml, buildOperationalEmailText } from '../../src/lib/operational-email'

describe('operational email', () => {
  it('renders the canonical Diamond Shine brand, operational details and CTA', () => {
    const html = buildOperationalEmailHtml({
      subject: 'Diamond Shine · Visit changed',
      eyebrow: 'Schedule changed',
      title: 'A confirmed visit changed',
      message: 'Review the latest schedule before travelling.',
      tone: 'warning',
      details: [
        { label: 'Client', value: 'EPAM' },
        { label: 'Site', value: 'The Academy' },
        { label: 'When', value: '8 Sep, 5:30 pm' },
      ],
      action: { label: 'Review visit', path: '/schedule?visit=visit-1' },
    })

    expect(html).toContain('Diamond Shine')
    expect(html).toContain('Operations Suite · Field service')
    expect(html).toContain('/icon.svg')
    expect(html).toContain('A confirmed visit changed')
    expect(html).toContain('The Academy')
    expect(html).toContain('#D97706')
    expect(html).toContain('#102A43')
    expect(html).toContain('#0F7A55')
    expect(html).toContain('Review visit')
    expect(html).toContain('schedule?visit=visit-1')
  })

  it('renders a plain-text fallback with the same important content and action', () => {
    const text = buildOperationalEmailText({
      subject: 'Diamond Shine · Time review',
      title: 'Employee requested a time correction',
      message: 'Review the original time record.',
      details: [{ label: 'Employee', value: 'Cleaner One' }],
      action: { label: 'Review time correction', path: '/field-control' },
    })

    expect(text).toContain('DIAMOND SHINE')
    expect(text).toContain('Employee: Cleaner One')
    expect(text).toContain('Review time correction:')
    expect(text).toContain('/field-control')
  })

  it('escapes employee and operations content before putting it in email html', () => {
    const html = buildOperationalEmailHtml({
      subject: 'Diamond Shine',
      title: '<script>alert(1)</script>',
      message: 'Reason: <b>unsafe</b> & unexpected',
      details: [{ label: '<Client>', value: 'A & B "Cleaning"' }],
    })

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<b>unsafe</b>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;b&gt;unsafe&lt;/b&gt; &amp; unexpected')
    expect(html).toContain('&lt;Client&gt;')
    expect(html).toContain('A &amp; B &quot;Cleaning&quot;')
  })

  it('rejects external or protocol-relative CTA paths', () => {
    const html = buildOperationalEmailHtml({
      subject: 'Diamond Shine',
      title: 'Security update',
      message: 'Check your account.',
      action: { label: 'Open account', path: '//evil.example/phish' },
    })

    expect(html).not.toContain('evil.example')
    expect(html).not.toContain('Open account')
  })
})
