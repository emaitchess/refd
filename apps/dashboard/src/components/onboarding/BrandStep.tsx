import { useEffect, useState } from 'react';
import { Favicon } from '@/components/ui';
import { onEnterKey, useEnterAdvance } from '@/lib/keyboard';
import { type OnboardingFlow, STEP_TITLES } from '@/lib/onboarding';
import type { OnboardingState } from '@/lib/types';
import { domainFromUrl, handleDomainPaste } from '@/lib/utils';
import type { OnboardingBrandDraft } from './OnboardingContext';
import { StepCard } from './StepCard';
import { StepNav } from './StepNav';
import { STEP_ICONS } from './step-icons';
import {
  type StepNavigationRegistrar,
  useStepNavigation,
} from './step-navigation';

const isValidDomain = (domain: string) => {
  let ascii = '';
  try {
    ascii = new URL(`https://${domain}`).hostname;
  } catch {
    return false;
  }
  const labels = ascii.split('.');
  const topLevelDomain = labels.at(-1) ?? '';
  return (
    ascii.length >= 3 &&
    ascii.length <= 253 &&
    labels.length >= 2 &&
    /[a-z]/i.test(topLevelDomain) &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
    )
  );
};

// Step 1: name the brand + list its domains. Committing creates the brand entity
// server-side (which advances the wizard to `describe`).
export const BrandStep = ({
  flow,
  state,
  registerNavigation,
  onDraftChange,
}: {
  flow: OnboardingFlow;
  state: OnboardingState;
  registerNavigation: StepNavigationRegistrar;
  onDraftChange: (draft: OnboardingBrandDraft) => void;
}) => {
  const [name, setName] = useState(state.brand?.name ?? '');
  const [domains, setDomains] = useState(
    (state.brand?.domains ?? []).join(', '),
  );
  const [aliases, setAliases] = useState(
    (state.brand?.aliases ?? []).map((a) => a.value).join(', '),
  );
  const [focused, setFocused] = useState(false);
  const parsedDomains = domains
    .split(',')
    .map(domainFromUrl)
    .filter(isValidDomain);
  // Favicon of the first valid domain, shown on the right once the input blurs.
  const firstDomain = parsedDomains[0] ?? '';

  useEffect(() => {
    onDraftChange({ name, domain: firstDomain || undefined });
  }, [firstDomain, name, onDraftChange]);

  const save = async (target: OnboardingState['step']) => {
    const brand = name.trim();
    const domainList = parsedDomains;
    const aliasList = aliases
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    if (!brand) {
      flow.setError('brand name is required');
      return;
    }
    if (domainList.length === 0) {
      flow.setError('add at least one domain, e.g. example.com');
      return;
    }
    const saved = await flow.saveBrand(brand, domainList, aliasList);
    if (saved && target !== 'describe') {
      await flow.goTo(target);
    }
  };
  const submit = () => void save('describe');
  const valid = name.trim().length > 0 && parsedDomains.length > 0;
  useStepNavigation(registerNavigation, 'brand', save, valid);

  useEnterAdvance(submit, !flow.busy);

  return (
    <StepCard
      step="brand"
      title={STEP_TITLES.brand}
      icon={STEP_ICONS.brand}
      error={flow.error}
      footer={<StepNav onNext={submit} busy={flow.busy} />}
    >
      <p className="max-w-[590px] text-[14px] text-secondary leading-[1.7]">
        Name the brand and add the domains that should count as your own. We use
        this identity to score mentions and citations across every tracked
        answer.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Brand name</span>
        <input
          className="input"
          placeholder="your brand"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnterKey(submit)}
          maxLength={100}
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Domains</span>
        <div className="relative">
          <input
            className="input pr-9"
            placeholder="comma-separated, e.g. example.com, example.ai"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            onKeyDown={onEnterKey(submit)}
            onPaste={(e) => handleDomainPaste(e, domains, setDomains, true)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          {!focused && firstDomain ? (
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
              <Favicon domain={firstDomain} size={18} />
            </span>
          ) : null}
        </div>
        <span className="text-[12px] text-muted leading-[1.55]">
          Apex domains only. Answers count as "cited" when a source URL matches
          one of these.
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Also known as</span>
        <input
          className="input"
          placeholder="comma-separated, e.g. former name, product name"
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          onKeyDown={onEnterKey(submit)}
          maxLength={400}
        />
        <span className="text-[12px] text-muted leading-[1.55]">
          Optional. Other names AI answers use for your brand: former names,
          product names, shorthands. Mentions of any of these count.
        </span>
      </label>
    </StepCard>
  );
};
