// trace.js — execution trace recorder
// Captures every API call, input, output, verdict, timing.
// Exported as structured JSON for the "auditable AI" positioning.

let _trace = null;

export function initTrace(prompt, effort, attachment) {
  _trace = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    prompt,
    effort,
    attachmentName: attachment?.name || null,
    plannerCall: null,
    agentCalls: [],
    verifierCalls: [],
    synthesisCall: null,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    durationMs: null,
    _startTime: Date.now(),
  };
  return _trace;
}

export function recordPlannerCall({ model, inputTokens, outputTokens, cost, plan, durationMs }) {
  if (!_trace) return;
  _trace.plannerCall = { model, inputTokens, outputTokens, cost, durationMs, plan };
  _accumulate(inputTokens, outputTokens, cost);
}

export function recordAgentCall({ agentId, agentName, model, task, inputTokens, outputTokens,
                                   cost, durationMs, stopReason, findings, summary }) {
  if (!_trace) return;
  _trace.agentCalls.push({
    agentId, agentName, model, task,
    inputTokens, outputTokens, cost, durationMs, stopReason,
    findings, summary,
  });
  _accumulate(inputTokens, outputTokens, cost);
}

export function recordVerifierCall({ agentId, agentName, model, passNum, inputTokens,
                                      outputTokens, cost, durationMs, stopReason,
                                      verdicts, summary, contestedIndexes }) {
  if (!_trace) return;
  _trace.verifierCalls.push({
    agentId, agentName, model, passNum,
    inputTokens, outputTokens, cost, durationMs, stopReason,
    verdicts, summary, contestedIndexes: contestedIndexes || [],
  });
  _accumulate(inputTokens, outputTokens, cost);
}

export function recordSynthesisCall({ model, inputTokens, outputTokens, cost,
                                       durationMs, stopReason, findings, summary }) {
  if (!_trace) return;
  _trace.synthesisCall = {
    model, inputTokens, outputTokens, cost, durationMs, stopReason, findings, summary,
  };
  _accumulate(inputTokens, outputTokens, cost);
}

export function finaliseTrace() {
  if (!_trace) return null;
  _trace.durationMs = Date.now() - _trace._startTime;
  delete _trace._startTime;
  return _trace;
}

export function getTrace() { return _trace; }

export function exportTrace() {
  if (!_trace) return;
  const json = JSON.stringify(_trace, null, 2);
  const a = document.createElement('a');
  a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
  a.download = `mc-trace-${_trace.id}.json`;
  a.click();
}

function _accumulate(inputTokens, outputTokens, cost) {
  _trace.totalInputTokens  += (inputTokens  || 0);
  _trace.totalOutputTokens += (outputTokens || 0);
  _trace.totalCost         += (cost         || 0);
}
