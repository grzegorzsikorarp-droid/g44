// Polska typografia według zasad językowych (brand/JEZYK.md), wspólna dla interfejsu i protokołu:
// twarda spacja po jednoliterowych spójnikach i przyimkach, po „§”, „nr”, „ust.”, „pkt”, „art.”, „godz.”,
// po liczbie rzymskiej („IX kadencja”) oraz między liczbą a jednostką, policzonym słowem („3 punkty”), ustępem
// („§ 8 ust. 2” nie łamie się wcale) albo nazwą miesiąca („19 listopada”).
// Przedział liczb z półpauzą („2024–2028”) nie łamie się między wierszami.
const glued = /^[(„»]?([aiouwzAIOUWZ]|§|nr|Nr|ust\.|pkt|art\.|godz\.)$/;
const roman = /^[IVXLC]+$/;
// „zł” tylko jako całe słowo („7 zł”), a nie początek wyrazu („7 złożono”).
const months = 'stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia';
const unit = new RegExp(`^(r\\.|zł(?!\\p{L})|min\\.?|dni|godz\\.|ust\\.|KB|MB|%|osób|osoby|osoba|głos|materiał|posiedzeń|posiedzeni|punkt|podpis|${months})`, 'u');

export function typo(text: string) {
  if (text.indexOf('–') > 0) text = text.replace(/(\d)–(?=\d)/g, '$1⁠–⁠');
  if (text.indexOf(' ') < 0) return text;
  const parts = text.split(/( +)/);
  for (let i = 0; i + 2 < parts.length; i += 2) {
    if (glued.test(parts[i]) || roman.test(parts[i]) || (/\d$/.test(parts[i]) && unit.test(parts[i + 2]))) parts[i + 1] = ' ';
  }
  return parts.join('');
}
