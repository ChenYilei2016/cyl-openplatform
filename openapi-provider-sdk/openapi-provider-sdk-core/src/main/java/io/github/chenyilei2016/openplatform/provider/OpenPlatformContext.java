package io.github.chenyilei2016.openplatform.provider;

import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.Callable;

/** 同步范围按栈恢复；异步必须显式捕获，不使用InheritableThreadLocal。 */
public final class OpenPlatformContext {
    private static final ThreadLocal<Scope> CURRENT = new ThreadLocal<>();

    private OpenPlatformContext() {}

    public static Optional<OpenPlatformIdentity> current() {
        Scope scope = CURRENT.get();
        return Optional.ofNullable(scope == null ? null : scope.identity);
    }

    public static OpenPlatformIdentity requireIdentity() {
        return current()
                .orElseThrow(
                        () ->
                                new OpenPlatformException(
                                        OpenPlatformException.Reason.CONTEXT_REQUIRED));
    }

    public static Scope open(OpenPlatformIdentity identity) {
        return new Scope(Objects.requireNonNull(identity, "identity"));
    }

    public static Snapshot snapshot() {
        return new Snapshot(current().orElse(null));
    }

    public static final class Scope implements AutoCloseable {
        private final Thread owner = Thread.currentThread();
        private final Scope previous = CURRENT.get();
        private final OpenPlatformIdentity identity;
        private boolean closed;

        private Scope(OpenPlatformIdentity identity) {
            this.identity = identity;
            CURRENT.set(this);
        }

        @Override
        public void close() {
            if (closed) return;
            if (Thread.currentThread() != owner || CURRENT.get() != this)
                throw new IllegalStateException("上下文必须在原线程按嵌套顺序关闭");
            closed = true;
            if (previous == null) CURRENT.remove();
            else CURRENT.set(previous);
        }
    }

    public static final class Snapshot {
        private final OpenPlatformIdentity identity;

        private Snapshot(OpenPlatformIdentity identity) {
            this.identity = identity;
        }

        /** 空快照也显式遮蔽工作线程的旧身份，关闭时恢复。 */
        public Scope open() {
            return new Scope(identity);
        }

        public Runnable wrap(Runnable task) {
            Objects.requireNonNull(task, "task");
            return () -> {
                try (Scope ignored = open()) {
                    task.run();
                }
            };
        }

        public <T> Callable<T> wrap(Callable<T> task) {
            Objects.requireNonNull(task, "task");
            return () -> {
                try (Scope ignored = open()) {
                    return task.call();
                }
            };
        }
    }
}
