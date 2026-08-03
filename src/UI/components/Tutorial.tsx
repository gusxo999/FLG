import { useState, useCallback } from 'react';
import { useT } from '../i18n';

const STORAGE_KEY = 'factorio-tutorial-done';

function Row({ keys, desc }: { keys: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <kbd className="bg-gray-700 border border-gray-500 rounded px-2 py-0.5 text-xs font-mono whitespace-nowrap shrink-0">
        {keys}
      </kbd>
      <span className="text-gray-300">{desc}</span>
    </div>
  );
}

export default function Tutorial() {
  const t = useT();

  const STEPS = [
    {
      title: t('tutorial.step1.title'),
      content: (
        <>
          <p>
            <strong>Factorio Layout Generator</strong>
            {t('tutorial.step1.appDescription')}
          </p>
          <p className="mt-2 text-gray-400 text-sm">
            {t('tutorial.step1.tutorialGuide')}
          </p>
        </>
      ),
    },
    {
      title: t('tutorial.step2.title'),
      content: (
        <>
          <p>
            {t('tutorial.step2.intro')}{' '}
            <strong>{t('tutorial.step2.sidebar')}</strong>
            {t('tutorial.step2.introEnd')}
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-gray-300">
            <li>
              <span className="text-orange-400 font-semibold">Palette</span>{' '}
              {t('tutorial.step2.paletteDesc')}
            </li>
            <li>
              <span className="text-orange-400 font-semibold">Recipes</span>{' '}
              {t('tutorial.step2.recipesDesc')}
            </li>
            <li>
              <span className="text-orange-400 font-semibold">Machines</span>{' '}
              {t('tutorial.step2.machinesDesc')}
            </li>
          </ul>
          <p className="mt-3 text-sm text-gray-400">
            {t('tutorial.step2.sizeInfo')}
          </p>
        </>
      ),
    },
    {
      title: t('tutorial.step3.title'),
      content: (
        <>
          <p>{t('tutorial.step3.intro')}</p>
          <div className="mt-3 space-y-2">
            <Row keys="Left Click" desc={t('tutorial.step3.place')} />
            <Row keys="Shift + Left Click" desc={t('tutorial.step3.erase')} />
          </div>
          <p className="mt-3 text-sm text-gray-400">
            {t('tutorial.step3.note')}
          </p>
        </>
      ),
    },
    {
      title: t('tutorial.step4.title'),
      content: (
        <>
          <p>{t('tutorial.step4.intro')}</p>
          <div className="mt-3 space-y-2">
            <Row keys="Middle Click + Drag" desc={t('tutorial.step4.panMiddle')} />
            <Row keys="Right Click + Drag" desc={t('tutorial.step4.panRight')} />
            <Row keys="Scroll Wheel" desc={t('tutorial.step4.zoom')} />
          </div>
        </>
      ),
    },
    {
      title: t('tutorial.step5.title'),
      content: (
        <>
          <p>{t('tutorial.step5.intro')}</p>
          <div className="mt-3 space-y-2">
            <Row keys="R" desc={t('tutorial.step5.rotate')} />
            <Row keys="Ctrl + Z" desc={t('tutorial.step5.undo')} />
            <Row keys="Ctrl + Y" desc={t('tutorial.step5.redo')} />
          </div>
          <p className="mt-3 text-sm text-gray-400">
            {t('tutorial.step5.rotateButtonIntro')} <strong>Rotate</strong>{' '}
            {t('tutorial.step5.rotateButton')}
          </p>
        </>
      ),
    },
    {
      title: t('tutorial.step6.title'),
      content: (
        <>
          <p>{t('tutorial.step6.intro')}</p>
          <div className="mt-3 space-y-2 text-sm text-gray-300">
            <li className="list-none">
              {t('tutorial.step6.exportStep')}{' '}
              <span className="text-orange-400 font-semibold">Export</span>{' '}
              {t('tutorial.step6.exportStepSuffix')}{' '}
              <code className="bg-gray-700 px-1 rounded">blueprint.txt</code>{' '}
              {t('tutorial.step6.fileSave')}
            </li>
            <li className="list-none">{t('tutorial.step6.useInGame')}</li>
            <li className="list-none">
              {t('tutorial.step6.importNote')}{' '}
              <span className="text-orange-400 font-semibold">Import</span>{' '}
              {t('tutorial.step6.importNoteSuffix')}
            </li>
          </div>
        </>
      ),
    },
  ];

  const [visible, setVisible] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) !== 'true';
  });
  const [step, setStep] = useState(0);

  const close = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
  }, []);

  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);
  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      close();
    }
  }, [step, close, STEPS.length]);

  if (!visible) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-white font-bold text-lg leading-tight">
            {current.title}
          </h2>
          <button
            onClick={close}
            className="text-gray-500 hover:text-gray-300 text-xl leading-none shrink-0 mt-0.5"
            title={t('tutorial.closeTooltip')}
          >
            ×
          </button>
        </div>

        <div className="text-gray-300 text-sm leading-relaxed">
          {current.content}
        </div>

        <div className="flex justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === step ? 'bg-orange-400' : 'bg-gray-600 hover:bg-gray-500'
              }`}
            />
          ))}
        </div>

        <div className="flex justify-between items-center">
          <button
            onClick={prev}
            disabled={step === 0}
            className="text-sm text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('tutorial.prev')}
          </button>
          <button
            onClick={next}
            className="bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold px-5 py-1.5 rounded-lg transition-colors"
          >
            {isLast ? t('tutorial.start') : t('tutorial.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
