import request from 'supertest';
import { expect, it } from 'vitest';
import full from '../../fixtures/analysis.full.json';
import { answersFor, appWith, output, rid, scriptedAnalyzer, snapshot } from './helpers';
import { validateAnalysisRelations } from '../../src/shared/validation';

const duplicate = () => {
  const data = structuredClone(full);
  data.facts[1] = {...data.facts[0]!, id: data.facts[1]!.id};
  return data;
};
it('repairs duplicate tasks detected after canonical ID assignment', async () => {
  const {analyzer, calls} = scriptedAnalyzer([async () => output(duplicate()), async () => output(full)]);
  const {app} = appWith({analyzer});
  const answers = answersFor('full');
  const res = await request(app).post('/api/analyze').send({requestId: rid(), snapshot: snapshot(answers)});
  expect(res.status).toBe(200);
  expect(calls).toHaveLength(2);
  expect(calls[1]!.repair).toBeDefined();
  expect(validateAnalysisRelations(res.body.analysis, answers)).toEqual([]);
});
it('rejects repeated invalid normalized output after one repair', async () => {
  const {analyzer, calls} = scriptedAnalyzer([async () => output(duplicate())]);
  const {app} = appWith({analyzer});
  const res = await request(app).post('/api/analyze').send({requestId: rid(), snapshot: snapshot(answersFor('full'))});
  expect(res.status).toBe(422);
  expect(res.body.error.code).toBe('INVALID_MODEL_OUTPUT');
  expect(calls).toHaveLength(2);
});
