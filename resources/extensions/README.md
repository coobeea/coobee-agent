# Extensions Resources

这里用于放置内置、受控的扩展包资源。

当前约定：

- `src/main/extension/`：运行期扩展机制（Agent event / interceptor）
- `resources/extensions/`：内置扩展包目录

当前说明：

- 本轮先建立通用目录
- 具体的第一个业务扩展场景后续再单独讨论
- 该目录不承担任意主进程代码插件的职责
