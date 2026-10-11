/** 彩色 HTTP 方法徽标（GET 绿 / POST 蓝 / PUT 橙 / DELETE 红，PATCH 紫），等宽字体。 */
export default function MethodBadge({ method }: { method: string }) {
  const value = method.toUpperCase();
  const tone = ["GET", "POST", "PUT", "DELETE", "PATCH"].includes(value) ? value.toLowerCase() : "other";
  return <span className={`op-method op-method--${tone}`}>{value}</span>;
}
