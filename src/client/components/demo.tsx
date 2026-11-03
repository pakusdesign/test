import { Select, SelectItem } from '@carbon/react';
import { useId } from 'react';
import type { QuestionId } from '../../shared/constants';
import type { ConfigResponse } from '../../shared/schemas';
import type { SessionState } from '../state/types';

export function configOf(s: SessionState): ConfigResponse | null {
  return s.config.status === 'ready' ? s.config.config : null;
}

export function modeOf(s: SessionState): 'demo' | 'live' | null {
  return configOf(s)?.mode ?? null;
}

export function scenarioOf(s: SessionState) {
  return configOf(s)?.demo?.scenarios.find((x) => x.id === s.demoScenarioId) ?? null;
}

/** Demo: выбор текста из каталога сценариев. Произвольный текст в demo не анализируется. */
export function DemoTextPicker({ s, questionId, onPick, label = 'Подставить текст из тестового сценария' }: {
  s: SessionState;
  questionId: QuestionId;
  onPick: (text: string) => void;
  label?: string;
}) {
  const id = useId();
  const catalog = configOf(s)?.demo?.catalog[questionId] ?? [];
  if (modeOf(s) !== 'demo' || catalog.length === 0) return null;
  return (
    <div className="demo-picker">
      <Select
        id={`demo-picker-${id}`}
        labelText={label}
        helperText="Демонстрация анализирует только эти тексты. Для произвольного текста нужен live."
        value=""
        size="md"
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
        }}
      >
        <SelectItem value="" text="Выберите текст…" />
        {catalog.map((text) => (
          <SelectItem key={text} value={text} text={text} />
        ))}
      </Select>
    </div>
  );
}
