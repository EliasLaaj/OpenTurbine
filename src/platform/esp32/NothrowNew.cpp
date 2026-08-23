#include <cstdlib>
#include <new>

// The Xtensa libstdc++ nothrow overload delegates to the throwing operator
// new. Under acute heap pressure that path tries to allocate a bad_alloc
// exception object and aborts when even that allocation cannot succeed. This
// is especially dangerous in AsyncTCP callbacks, which correctly test the
// nothrow result but never get a null pointer from the stock implementation.
//
// Give both ESP32 targets the contract the call sites requested: return null
// and let their existing bounded retry/drop paths handle temporary pressure.
void* operator new(std::size_t size, const std::nothrow_t&) noexcept {
    return std::malloc(size ? size : 1);
}

void* operator new[](std::size_t size, const std::nothrow_t&) noexcept {
    return std::malloc(size ? size : 1);
}

void operator delete(void* pointer, const std::nothrow_t&) noexcept {
    std::free(pointer);
}

void operator delete[](void* pointer, const std::nothrow_t&) noexcept {
    std::free(pointer);
}
