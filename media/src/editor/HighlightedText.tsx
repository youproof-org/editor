import { fold } from './textFold';

interface Props {
  text:  string;
  typed: string;
}

export default function HighlightedText({ text, typed }: Props) {
  if (!typed) return <>{text}</>;
  const foldedNeedle = fold(typed).toLowerCase();
  if (!foldedNeedle) return <>{text}</>;
  const idx = fold(text).toLowerCase().indexOf(foldedNeedle);
  if (idx === -1) return <>{text}</>;
  const len = foldedNeedle.length;
  return (
    <>
      {text.slice(0, idx)}
      <strong>{text.slice(idx, idx + len)}</strong>
      {text.slice(idx + len)}
    </>
  );
}
