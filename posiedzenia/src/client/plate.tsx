import {brand} from './brand.ts';

const logoAlt = () => `Znak ${brand.org.replace(/^Okręgowa Izba/, 'Okręgowej Izby')}`;

/**
 * Znak Izby z nazwą, zawsze na białym tle. W wersji próbnej zamiast znaku jest neutralny znaczek.
 * `decorative` daje pusty opis obrazu, gdy nazwę niesie otaczający odnośnik (górny pasek).
 */
export function Plate(props: {big?: boolean; decorative?: boolean}) {
  if (!brand.logo || !brand.nameplate) return <span class="mark-box" aria-hidden="true"><span class="oi-mark"/></span>;
  const alt = props.decorative ? '' : logoAlt();
  if (props.big) return <div class="oi-nameplate"><img src={brand.logo} alt={alt}/><p class="oi-nameplate__name">{brand.nameplate[0]} <b>{brand.nameplate[1]}</b></p></div>;
  return <span class="plate"><img src={brand.logo} alt={alt}/><span class="plate-name">{brand.nameplate[0]} <b>{brand.nameplate[1]}</b></span></span>;
}
