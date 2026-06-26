interface Props {
  label: string;
  children: React.ReactNode;
}

export default function Field({ label, children }: Props) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-control">{children}</div>
    </div>
  );
}
