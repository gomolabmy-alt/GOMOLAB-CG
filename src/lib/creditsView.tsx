// Shared presentational content for kind:'credits' — see TemplateElement's
// own doc comment on the kind (types/canvas.ts) for the full field list.
// A genuine shared component (not duplicated per-renderer like most other
// kinds' JSX in this app) since the actual visual content here is identical
// between CgTemplateWidget.tsx's real output and CgTemplateDesigner.tsx's
// preview — only the OUTER animation wiring differs (see
// lib/useCreditsAnimation.ts), which stays entirely in each renderer's own
// file via the `innerRef` callback below.
import type { CreditsSection } from '../types/canvas';
import { fontFamilyCss } from './cgFonts';
import { resolveImageUrl } from './imageUrl';

export interface CreditsStyle {
  fontFamily?: string;
  align: 'left' | 'center' | 'right';
  titleFontSize: number;
  titleColor: string;
  titleBold: boolean;
  roleFontSize: number;
  roleColor: string;
  nameFontSize: number;
  nameColor: string;
  nameBold: boolean;
  entryGap: number;
  sectionGap: number;
  /** An entry's own `logoUrl` (see CreditsEntry's own doc comment) renders
   *  at this height, px — width follows the image's own aspect ratio. */
  logoHeight: number;
}

export function creditsStyleFromConfig(config: Record<string, any>): CreditsStyle {
  return {
    fontFamily: config.fontFamily,
    align: config.align ?? 'center',
    titleFontSize: config.titleFontSize ?? 22,
    titleColor: config.titleColor ?? '#ffffff',
    titleBold: config.titleBold ?? true,
    roleFontSize: config.roleFontSize ?? 15,
    roleColor: config.roleColor ?? '#aaaaaa',
    nameFontSize: config.nameFontSize ?? 18,
    nameColor: config.nameColor ?? '#ffffff',
    nameBold: config.nameBold ?? false,
    entryGap: config.entryGap ?? 6,
    sectionGap: config.sectionGap ?? 36,
    logoHeight: config.logoHeight ?? 60,
  };
}

/** One section's own title + entries. An entry with its own `logoUrl` set
 *  renders that image (at `style.logoHeight`, aspect-preserved) instead of
 *  role/name text — `name`, if ALSO set, becomes a small caption under the
 *  logo (a sponsor's own name under its mark), `role` is ignored for a
 *  logo entry (there's no sensible place for it next to an image). An
 *  entry with no logo and no `role` renders just its (bold-by-config)
 *  name, centered/aligned the same as every other line; one WITH a role
 *  renders "Role, Name" stacked as two lines (role small/muted above, name
 *  below) so a department credit reads clearly without a two-column
 *  layout. */
export function CreditsSectionContent({ section, style }: { section: CreditsSection; style: CreditsStyle }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: style.align === 'left' ? 'flex-start' : style.align === 'right' ? 'flex-end' : 'center', textAlign: style.align, fontFamily: fontFamilyCss(style.fontFamily) }}>
      {section.title && (
        <div style={{ fontSize: style.titleFontSize, color: style.titleColor, fontWeight: style.titleBold ? 700 : 400, letterSpacing: 1, marginBottom: style.entryGap * 2, whiteSpace: 'nowrap' }}>
          {section.title}
        </div>
      )}
      {section.entries.map((entry) => (
        <div key={entry.id} style={{ marginBottom: style.entryGap, display: 'flex', flexDirection: 'column', alignItems: 'inherit' }}>
          {entry.logoUrl ? (
            <>
              <img src={resolveImageUrl(entry.logoUrl)} alt={entry.name || ''} style={{ height: style.logoHeight, maxWidth: style.logoHeight * 4, objectFit: 'contain' }} />
              {entry.name && (
                <div style={{ fontSize: style.nameFontSize * 0.7, color: style.nameColor, marginTop: 2, whiteSpace: 'nowrap' }}>{entry.name}</div>
              )}
            </>
          ) : (
            <>
              {entry.role && (
                <div style={{ fontSize: style.roleFontSize, color: style.roleColor, whiteSpace: 'nowrap' }}>{entry.role}</div>
              )}
              <div style={{ fontSize: style.nameFontSize, color: style.nameColor, fontWeight: style.nameBold ? 700 : 400, whiteSpace: 'nowrap' }}>{entry.name}</div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
