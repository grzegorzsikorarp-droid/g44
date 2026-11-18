// Polska typografia według zasad językowych (brand/JEZYK.md), wspólna dla interfejsu i protokołu:
// twarda spacja po jednoliterowych spójnikach i przyimkach, po „§”, „nr”, „ust.”, „pkt”, „art.”, „godz.”,
// po liczbie rzymskiej („IX kadencja”) oraz między liczbą a jednostką albo policzonym słowem („3 punkty”).
// Przedział liczb z półpauzą („2024–2028”) nie łamie się między wierszami.
const glued = /^[(„»]?([aiouwzAIOUWZ]|§|nr|Nr|ust\.|pkt|art\.|godz\.)$/;
const roman = /^[IVXLC]+$/;
const unit = /^(r\.|zł|min\.?|dni|godz\.|KB|MB|%|osób|osoby|osoba|głos|materiał|posiedzeń|posiedzeni|punkt|podpis)/;

export function typo(text: string) {
  if (text.indexOf('–') > 0) text = text.replace(/(\d)–(?=\d)/g, '$1⁠–⁠');
  if (text.indexOf(' ') < 0) return text;
  const parts = text.split(/( +)/);
  for (let i = 0; i + 2 < parts.length; i += 2) {
    if (glued.test(parts[i]) || roman.test(parts[i]) || (/\d$/.test(parts[i]) && unit.test(parts[i + 2]))) parts[i + 1] = ' ';
  }
  return parts.join('');
}
