import { describe, expect, it } from 'vitest'
import { buildOperationalEmailHtml } from '../../src/lib/operational-email'

describe('operational email', () => {
  it('renders the Diamond Shine brand and operational details', () => {
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
    })

    expect(html).toContain('💎 Diamond Shine')
    expect(html).toContain('Operations · Field service')
    expect(html).toContain('A confirmed visit changed')
    expect(html).toContain('The Academy')
    expect(html).toContain('#D97706')
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
})
