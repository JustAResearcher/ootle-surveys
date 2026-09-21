import type { Question } from "./api";
export function QuestionEditor({
  question,
  index,
  onChange,
  onDelete,
  canDelete,
}: {
  question: Question;
  index: number;
  onChange: (q: Question) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  return (
    <section className="question-editor">
      <div className="question-head">
        <label htmlFor={"q-" + question.id}>Question {index + 1}</label>
        {canDelete && (
          <button
            type="button"
            className="text-button muted"
            onClick={onDelete}
            aria-label={`Remove question ${index + 1}`}
          >
            Remove
          </button>
        )}
      </div>
      <div className="question-row">
        <input
          id={"q-" + question.id}
          value={question.text}
          onChange={(e) => onChange({ ...question, text: e.target.value })}
          placeholder="Write your question"
          maxLength={240}
          required
        />
        <select
          aria-label={`Question ${index + 1} type`}
          value={question.type}
          onChange={(e) =>
            onChange({ ...question, type: e.target.value as Question["type"] })
          }
        >
          <option value="short">Short answer</option>
          <option value="long">Long answer</option>
          <option value="choice">Multiple choice</option>
          <option value="rating">Rating (1–5)</option>
        </select>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={question.required}
            onChange={(e) =>
              onChange({ ...question, required: e.target.checked })
            }
          />
          <span className="toggle" />
          Required
        </label>
      </div>
      {question.type === "choice" && (
        <label className="choices-label">
          Choices, one per line
          <textarea
            value={question.options.join("\n")}
            onChange={(e) =>
              onChange({ ...question, options: e.target.value.split("\n") })
            }
            placeholder={"First choice\nSecond choice"}
            required
            rows={3}
          />
        </label>
      )}
    </section>
  );
}
