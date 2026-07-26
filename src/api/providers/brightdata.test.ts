import { describe, expect, spyOn, test } from 'bun:test';
import {
  normalizeDatasetRecord,
  ProviderRetryableError,
  readSnapshotRecords,
} from './brightdata';

const streamOf = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
};

describe('normalizeDatasetRecord', () => {
  test('strips the trailing ChatGPT sponsored unit from the scored text', () => {
    const { answerText } = normalizeDatasetRecord({
      answer_text:
        'Keyboard Maestro is generally the more dependable approach. Speechify Text to audio converter Paste text, get natural audio. Free to try. Ad Sponsored options',
      answer_text_markdown:
        'Keyboard Maestro is generally the more dependable approach.\n\n' +
        '![](https://bzrcdn.openai.com/11cf97094ec63103.png) \n\n' +
        '![](https://bzrcdn.openai.com/739f8ac3d536c8d9.ico) \n\n' +
        'Speechify\n\nText to audio converter\n\nPaste text, get natural audio. Free to try.\n\nAd\n\nSponsored options',
    });
    expect(answerText).toBe(
      'Keyboard Maestro is generally the more dependable approach.',
    );
  });

  test('a sponsored terminator without a derivable boundary warns and keeps the text', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const text = 'An organic answer. Some card copy. Ad Sponsored options';
    const { answerText } = normalizeDatasetRecord({
      answer_text: text,
      // Markdown lacks the ad-image block, so the cut point cannot be anchored.
      answer_text_markdown: text,
    });
    expect(answerText).toBe(text);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('an answer with no sponsored tail is untouched', () => {
    const { answerText } = normalizeDatasetRecord({
      answer_text: 'A clean answer about additional options.',
    });
    expect(answerText).toBe('A clean answer about additional options.');
  });

  test('drops phantom site-roots from URL-valued domain fields (Perplexity shape)', () => {
    const { sourceUrls } = normalizeDatasetRecord({
      answer_text: 'An answer.',
      citations: [
        {
          url: 'https://modelpiper.com/workflow/mac-automation',
          domain: 'https://modelpiper.com/',
          position: null,
        },
        {
          url: 'https://www.echoo.ai/use-cases/voice-commands-mac',
          domain: 'https://www.echoo.ai/',
          position: null,
        },
      ],
    });
    expect(sourceUrls).toEqual([
      'https://modelpiper.com/workflow/mac-automation',
      'https://www.echoo.ai/use-cases/voice-commands-mac',
    ]);
  });

  test('a bare root with no deeper URL from its origin is a real citation', () => {
    const { sourceUrls } = normalizeDatasetRecord({
      answer_text: 'An answer.',
      citations: [
        { url: 'https://example.com/', domain: 'example.com' },
        { url: 'https://other.com/article', domain: 'other.com' },
      ],
    });
    expect(sourceUrls).toEqual([
      'https://example.com/',
      'https://other.com/article',
    ]);
  });

  test('favicon and thumbnail service URLs never become citations (ChatGPT icon fields)', () => {
    const { sourceUrls } = normalizeDatasetRecord({
      answer_text: 'An answer.',
      citations: [
        {
          url: 'https://www.tomsguide.com/best-dictation-apps',
          icon: 'https://www.google.com/s2/favicons?domain=https://www.tomsguide.com&sz=32',
          domain: 'tomsguide.com',
        },
        {
          url: 'https://talk.macpowerusers.com/t/voice-control/123',
          icon: 'https://encrypted-tbn3.gstatic.com/faviconV2?url=https://talk.macpowerusers.com',
          domain: 'talk.macpowerusers.com',
        },
      ],
    });
    expect(sourceUrls).toEqual([
      'https://www.tomsguide.com/best-dictation-apps',
      'https://talk.macpowerusers.com/t/voice-control/123',
    ]);
  });

  test('root artifacts only suppress their own origin, not sibling hosts', () => {
    const { sourceUrls } = normalizeDatasetRecord({
      answer_text: 'An answer.',
      citations: [
        {
          url: 'https://eplt.medium.com/how-i-automate',
          domain: 'https://eplt.medium.com/',
        },
        { url: 'https://medium.com/', domain: 'medium.com' },
      ],
    });
    // eplt.medium.com and medium.com are different origins — the bare
    // medium.com root survives because no deeper medium.com URL exists.
    expect(sourceUrls).toEqual([
      'https://eplt.medium.com/how-i-automate',
      'https://medium.com/',
    ]);
  });
});

describe('readSnapshotRecords', () => {
  test('parses NDJSON into one record per line', async () => {
    const records = await readSnapshotRecords(
      streamOf([
        '{"prompt":"a","answer_text":"A"}\n{"prompt":"b","answer_text":"B"}\n',
      ]),
    );
    expect(records).toEqual([
      { prompt: 'a', answer_text: 'A' },
      { prompt: 'b', answer_text: 'B' },
    ]);
  });

  test('buffers a record split across chunk boundaries', async () => {
    const records = await readSnapshotRecords(
      streamOf([
        '{"prompt":"a","ans',
        'wer_text":"A"}\n{"prompt":"b"',
        ',"answer_text":"B"}',
      ]),
    );
    expect(records).toEqual([
      { prompt: 'a', answer_text: 'A' },
      { prompt: 'b', answer_text: 'B' },
    ]);
  });

  test('skips blank lines and tolerates a missing trailing newline', async () => {
    const records = await readSnapshotRecords(
      streamOf(['\n{"prompt":"a"}\n\n{"prompt":"b"}']),
    );
    expect(records).toEqual([{ prompt: 'a' }, { prompt: 'b' }]);
  });

  test('falls back to a JSON array body', async () => {
    const records = await readSnapshotRecords(
      streamOf(['[{"prompt":"a"},', '{"prompt":"b"}]']),
    );
    expect(records).toEqual([{ prompt: 'a' }, { prompt: 'b' }]);
  });

  test('an empty (or whitespace-only) body yields no records', async () => {
    expect(await readSnapshotRecords(streamOf([]))).toEqual([]);
    expect(await readSnapshotRecords(streamOf(['\n\n']))).toEqual([]);
  });

  test('a lone status envelope without a prompt is retryable, not a record', async () => {
    await expect(
      readSnapshotRecords(streamOf(['{"status":"building"}'])),
    ).rejects.toBeInstanceOf(ProviderRetryableError);
  });

  test('a single real record (one-prompt snapshot) is kept', async () => {
    const records = await readSnapshotRecords(
      streamOf(['{"prompt":"solo","answer_text":"X"}']),
    );
    expect(records).toEqual([{ prompt: 'solo', answer_text: 'X' }]);
  });
});
