import {brand} from './brand.ts';

const logoAlt = () => `Znak ${brand.org.replace(/^Okręgowa Izba/, 'Okręgowej Izby')}`;

/** Znak Izby z nazwą, zawsze na białym tle. W wersji próbnej zamiast znaku jest neutralny znaczek. */
export function Plate(props: {big?: boolean}) {
  if (!brand.logo || !brand.nameplate) return <span class="mark-box" aria-hidden="true"><span class="oi-mark"/></span>;
  if (props.big) return <div class="oi-nameplate"><img src={brand.logo} alt={logoAlt()}/><p class="oi-nameplate__name">{brand.nameplate[0]} <b>{brand.nameplate[1]}</b></p></div>;
  return <span class="plate"><img src={brand.logo} alt={logoAlt()}/><span class="plate-name">{brand.nameplate[0]} <b>{brand.nameplate[1]}</b></span></span>;
}
