export const PageHeader = ({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) => (
  <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 className="font-[550] text-[22px] text-primary tracking-[-0.025em]">
        {title}
      </h1>
      {description ? (
        <p className="mt-1 max-w-2xl text-[13px] text-muted leading-relaxed">
          {description}
        </p>
      ) : null}
    </div>
    {actions ? (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {actions}
      </div>
    ) : null}
  </header>
);
