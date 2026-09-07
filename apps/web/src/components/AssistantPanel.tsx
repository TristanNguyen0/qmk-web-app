'use client';

/**
 * Describe a change in words; review exactly what it would do; apply it or not.
 *
 * The assistant returns a *candidate* document, never a saved one. This panel shows
 * the model's summary, the concrete list of changes the resolver made, anything the
 * request asked for that the product cannot express, and anything the resolver
 * refused — and only then offers **Apply**, which is one editor step (one undo) and
 * goes through the ordinary autosave and server validation like any other edit. The
 * panel never talks to the build queue.
 */
import { useState } from 'react';
import type { EditorDocument } from '../lib/editor-state.ts';
import {
  ApiRequestError,
  requestAssistantProposal,
  type AssistantProposalResponse,
  type AssistantStatusResponse,
} from '../lib/client.ts';

export interface AssistantPanelProps {
  configurationId: string;
  status: AssistantStatusResponse | null;
  document: EditorDocument;
  /** Called with the candidate when the user applies it. */
  onApply: (document: EditorDocument) => void;
  /** Positions the pending proposal would change, for highlighting; null clears. */
  onPreview: (changes: AssistantProposalResponse['changes'] | null) => void;
}

const EXAMPLES = [
  'Start from the default layout and make Caps Lock an extra Escape.',
  'Add a Fn layer held on the right Alt key with arrows on IJKL.',
  'Turn on SOCD (last input wins) for WASD.',
];

type PanelState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'proposal'; proposal: AssistantProposalResponse }
  | { kind: 'error'; message: string };

export function AssistantPanel({ configurationId, status, document, onApply, onPreview }: AssistantPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<PanelState>({ kind: 'idle' });

  if (!status?.enabled) {
    // Not configured on this server. Say so briefly rather than showing a dead form.
    return null;
  }
  const maxLength = status.limits.maxPromptLength;

  async function submit() {
    const text = prompt.trim();
    if (text === '' || state.kind === 'pending') return;
    setState({ kind: 'pending' });
    onPreview(null);
    try {
      const proposal = await requestAssistantProposal(configurationId, text, document);
      setState({ kind: 'proposal', proposal });
      onPreview(proposal.changes);
    } catch (error) {
      const message =
        error instanceof ApiRequestError
          ? error.status === 429
            ? `${error.message}.`
            : error.message
          : 'could not reach the server';
      setState({ kind: 'error', message });
    }
  }

  function discard() {
    setState({ kind: 'idle' });
    onPreview(null);
  }

  function apply(proposal: AssistantProposalResponse) {
    onApply({
      name: proposal.candidate.name,
      layers: proposal.candidate.layers,
      macros: proposal.candidate.macros,
      socd: proposal.candidate.socd,
    });
    setState({ kind: 'idle' });
    setPrompt('');
    onPreview(null);
  }

  return (
    <section className="assistant" aria-labelledby="assistant-heading">
      <h2 id="assistant-heading">Describe a change</h2>
      <p className="muted">
        Say what you want in plain words. You will see exactly what would change before anything is
        applied, and applying is one undoable step. The assistant can only use features this editor
        offers; anything else is listed as not possible rather than approximated.
      </p>

      <form
        className="assistant__form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="visually-hidden" htmlFor="assistant-prompt">
          Describe the change you want
        </label>
        <textarea
          id="assistant-prompt"
          rows={3}
          maxLength={maxLength}
          value={prompt}
          placeholder={EXAMPLES[0]}
          disabled={state.kind === 'pending'}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="assistant__actions">
          <button type="submit" disabled={state.kind === 'pending' || prompt.trim() === ''}>
            {state.kind === 'pending' ? 'Thinking…' : 'Propose changes'}
          </button>
          <span className="muted" style={{ fontSize: '0.8125rem' }}>
            {prompt.length}/{maxLength} · {status.limits.requestsPerOwnerPerHour} requests per hour ·{' '}
            model <code>{status.model}</code>
          </span>
        </div>
        {state.kind === 'idle' && prompt === '' ? (
          <p className="muted assistant__examples">
            Try:{' '}
            {EXAMPLES.map((example, i) => (
              <button key={example} type="button" className="assistant__example" onClick={() => setPrompt(example)}>
                {example}
                {i < EXAMPLES.length - 1 ? ' ' : ''}
              </button>
            ))}
          </p>
        ) : null}
      </form>

      {state.kind === 'error' ? (
        <p className="notice" role="alert">
          {state.message}
        </p>
      ) : null}

      {state.kind === 'proposal' ? <Proposal proposal={state.proposal} onApply={apply} onDiscard={discard} /> : null}
    </section>
  );
}

function Proposal({
  proposal,
  onApply,
  onDiscard,
}: {
  proposal: AssistantProposalResponse;
  onApply: (proposal: AssistantProposalResponse) => void;
  onDiscard: () => void;
}) {
  const applicable = proposal.validation.ok && proposal.changes.length > 0;
  const partial = proposal.issues.length > 0;

  return (
    <div className="assistant__proposal" role="region" aria-live="polite" aria-label="Proposed changes">
      {partial ? (
        // The model wrote its summary before the resolver refused anything, so it may
        // describe work that did not happen. Frame it as intent, not as fact.
        <p className="assistant__summary">
          <span className="muted">The assistant intended: </span>
          {proposal.summary}
        </p>
      ) : (
        <p className="assistant__summary">{proposal.summary}</p>
      )}

      {proposal.changes.length > 0 ? (
        <>
          <h3>What would change</h3>
          <ul className="assistant__changes">
            {proposal.changes.map((change, i) => (
              <li key={i}>{change.description}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">No changes were proposed.</p>
      )}

      {proposal.unsupported.length > 0 ? (
        <>
          <h3>Not possible here</h3>
          <ul className="assistant__unsupported">
            {proposal.unsupported.map((item, i) => (
              <li key={i}>
                <strong>{item.request}</strong> — {item.reason}
                {item.alternative ? (
                  <>
                    {' '}
                    <span className="muted">Instead: {item.alternative}</span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {partial ? (
        <div className="notice">
          <strong>Some of the proposal could not be applied</strong> and was left out:
          <ul>
            {proposal.issues.map((issue) => (
              <li key={issue.operation}>{issue.reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!proposal.validation.ok ? (
        <div className="notice" role="alert">
          <strong>This proposal would not be accepted by the server</strong> ({proposal.validation.code}):{' '}
          {proposal.validation.message}
          {proposal.validation.fieldErrors.length > 0 ? (
            <ul>
              {proposal.validation.fieldErrors.slice(0, 8).map((fe) => (
                <li key={`${fe.path}:${fe.message}`}>
                  <code>{fe.path}</code> — {fe.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="assistant__actions">
        <button type="button" onClick={() => onApply(proposal)} disabled={!applicable}>
          {partial ? 'Apply what could be done' : 'Apply'}
        </button>
        <button type="button" onClick={onDiscard}>
          Discard
        </button>
        <span className="muted" style={{ fontSize: '0.8125rem' }}>
          Applying is one step: Undo reverses all of it. Nothing is saved or built until you do.
        </span>
      </div>
    </div>
  );
}
