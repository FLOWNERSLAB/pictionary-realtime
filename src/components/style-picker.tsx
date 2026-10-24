import { STYLE_GROUPS, STYLE_GROUP_LABEL, styleKey, stylesIn } from '../data/styles';

type StylePickerProps = {
  value: string;
  onChange: (id: string) => void;
};

export const StylePicker = ({ value, onChange }: StylePickerProps) => (
  <div className="flex flex-col gap-2" role="group" aria-label="Estilo">
    {STYLE_GROUPS.map(group => (
      <div key={group} className="flex items-center gap-3">
        <span className="text-neutral-10 w-14 shrink-0 text-[11px] tracking-wide uppercase">{STYLE_GROUP_LABEL[group]}</span>
        <div className="lab-scroll-x flex min-w-0 flex-1 gap-2 overflow-x-auto pr-8">
          {stylesIn(group).map(style => {
            const key = styleKey(style.id);

            return (
              <button
                key={style.id}
                type="button"
                className="lab-chip"
                aria-pressed={style.id === value}
                title={key ? `Tecla ${key} · ${style.look}` : style.look}
                onClick={() => onChange(style.id)}
              >
                {key ? <span className="lab-chip-key">{key}</span> : null}
                {style.label}
              </button>
            );
          })}
        </div>
      </div>
    ))}
  </div>
);
