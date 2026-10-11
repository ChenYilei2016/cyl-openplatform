import { Button, Popover } from "antd";
import type { ReactNode } from "react";
export default function PublicationHelp({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Popover
      trigger="click"
      title={title}
      styles={{ root: { maxWidth: 420 } }}
      content={children}
    >
      <Button type="text" size="small" aria-label={`${title}说明`}>
        ?
      </Button>
    </Popover>
  );
}
