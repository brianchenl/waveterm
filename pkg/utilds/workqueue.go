package utilds

import "sync"

const DefaultWorkQueueLimit = 1024

type WorkQueue[T any] struct {
	lock     sync.Mutex
	cond     *sync.Cond
	queue    []T
	closed   bool
	started  bool
	maxItems int
	wg       sync.WaitGroup
	workFn   func(T)
}

func NewWorkQueue[T any](workFn func(T)) *WorkQueue[T] {
	return NewWorkQueueWithLimit(workFn, DefaultWorkQueueLimit)
}

func NewWorkQueueWithLimit[T any](workFn func(T), maxItems int) *WorkQueue[T] {
	wq := &WorkQueue[T]{
		workFn:   workFn,
		maxItems: maxItems,
	}
	wq.cond = sync.NewCond(&wq.lock)
	return wq
}

func (wq *WorkQueue[T]) Enqueue(item T) bool {
	wq.lock.Lock()
	defer wq.lock.Unlock()
	if wq.closed {
		return false
	}
	if wq.maxItems > 0 && len(wq.queue) >= wq.maxItems {
		return false
	}
	if !wq.started {
		wq.started = true
		wq.wg.Add(1)
		go wq.worker()
	}
	wq.queue = append(wq.queue, item)
	wq.cond.Signal()
	return true
}

func (wq *WorkQueue[T]) worker() {
	defer wq.wg.Done()
	for {
		wq.lock.Lock()
		for len(wq.queue) == 0 && !wq.closed {
			wq.cond.Wait()
		}

		if wq.closed && len(wq.queue) == 0 {
			wq.lock.Unlock()
			return
		}

		item := wq.queue[0]
		var zero T
		wq.queue[0] = zero
		if len(wq.queue) == 1 {
			wq.queue = nil
		} else {
			wq.queue = wq.queue[1:]
		}
		wq.lock.Unlock()

		wq.workFn(item)
	}
}

func (wq *WorkQueue[T]) Close(immediate bool) {
	wq.lock.Lock()
	wq.closed = true
	if immediate {
		wq.queue = nil
	}
	wq.cond.Broadcast()
	wq.lock.Unlock()
}

func (wq *WorkQueue[T]) Wait() {
	wq.wg.Wait()
}
