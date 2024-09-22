---
title: "Managing Distributed Transactions"
categories: [microservices, design-patterns]
date: 2024-08-13 00:00:00
tags: [microservices, saga-pattern, distributed-transactions, design-patterns, architecturea, atomicity, consistency]
image: "/assets/images/saga.png"
---


## Introduction
In a monolithic system, updating inventory and creating an order happen within a single transaction, ensuring atomicity and consistency. However, in a microservices architecture, these operations are split across different services. The challenge is to maintain data consistency across these services when one operation could fail while others succeed.

## The Problem

### Data Inconsistency in Microservices

When dealing with distributed systems, especially in e-commerce platforms, several services interact to complete a single business transaction:

- **Product Service**: Manages inventory.
- **Order Service**: Handles order creation and management.
- **Payment Service**: Processes payments.

The primary challenge is ensuring that operations across these services are consistent. For example, what happens if the inventory is reserved, but the payment fails? Without proper handling, this could lead to:

- **Stock Discrepancies**: Inventory remains reserved indefinitely.
- **Incomplete Orders**: Orders remain in an inconsistent state.
- **Financial Errors**: Payments may be processed without corresponding orders.

## The Solution: Implementing the Saga Pattern

### What is the Saga Pattern?

The **Saga Pattern** is a design pattern that provides a way to manage data consistency across microservices in distributed transaction scenarios. It does this by:

- **Breaking Down Transactions**: Splitting a transaction into a series of smaller, local transactions.
- **Compensating Actions**: If a transaction fails, compensating transactions are executed to undo the changes made by preceding transactions.
- **Asynchronous Execution**: Transactions are executed asynchronously, improving system performance and scalability.


## Updated Architecture Overview


### Services Involved

1. **Product Service**: Manages inventory stock levels.
2. **Order Service**: Handles order creation and status updates.
3. **Payment Service**: Processes payments and handles refunds.
4. **Orchestrator Service**: Coordinates the workflow between services, implementing the Saga Pattern.


### High-Level Workflow

```mermaid

graph TD
    StartOrder["Start Order Process"]
    ReserveStock["Reserve Stock\n(Product Service)"]
    CreatePendingOrder["Create Pending Order\n(Order Service)"]
    ProcessPayment["Process Payment\n(Payment Service)"]
    ConfirmOrder["Confirm Order\n(Order Service)"]
    ConfirmStockReduction["Confirm Stock Reduction\n(Product Service)"]
    OrderSuccess["Order Completed Successfully"]
    OrderFailure["Order Failed"]

    StartOrder --> ReserveStock
    ReserveStock -->|Success| CreatePendingOrder
    ReserveStock -->|Failure| OrderFailure
    CreatePendingOrder -->|Success| ProcessPayment
    CreatePendingOrder -->|Failure| ReleaseStock["Release Reserved Stock\n(Product Service)"] --> OrderFailure
    ProcessPayment -->|Success| ConfirmOrder
    ProcessPayment -->|Failure| CancelOrder["Cancel Order\n(Order Service)"] --> ReleaseStockAfterPaymentFailure["Release Reserved Stock\n(Product Service)"] --> OrderFailure
    ConfirmOrder -->|Success| ConfirmStockReduction
    ConfirmOrder -->|Failure| RefundPayment["Refund Payment\n(Payment Service)"] --> CancelOrderAfterConfirmFailure["Cancel Order\n(Order Service)"] --> ReleaseStockAfterConfirmFailure["Release Reserved Stock\n(Product Service)"] --> OrderFailure
    ConfirmStockReduction --> OrderSuccess

    style OrderSuccess fill:#e6ffe6,stroke:#66cc66
    style OrderFailure fill:#ffe6e6,stroke:#ff6666

```

### Error Handling and Compensating Transactions

- **Stock Reservation Fails**: Return error to client; no further action needed.
- **Order Creation Fails**: Release reserved stock.
- **Payment Fails**: Cancel order and release reserved stock.
- **Order Confirmation Fails**: Initiate compensating transactions, such as refunding the payment and releasing reserved stock. 

## Detailed Code Implementation

```javascript
// Product Service
const productService = {
  async reserveStock(productId, quantity) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const product = await Product.findOne({ _id: productId }).session(session);
      if (!product || product.stock - product.reservedQuantity < quantity) {
        throw new Error('Insufficient available stock');
      }

      await Product.updateOne(
        { _id: productId },
        { $inc: { reservedQuantity: quantity } }
      ).session(session);

      await session.commitTransaction();
      return true;
    } catch (error) {
      await session.abortTransaction();
      console.error('Stock reservation failed:', error);
      return false;
    } finally {
      session.endSession();
    }
  },

  async confirmStockReduction(productId, quantity) {
    await Product.updateOne(
      { _id: productId },
      { 
        $inc: { 
          stock: -quantity,
          reservedQuantity: -quantity 
        } 
      }
    );
  },

  async releaseReservedStock(productId, quantity) {
    await Product.updateOne(
      { _id: productId },
      { $inc: { reservedQuantity: -quantity } }
    );
  }
};

// Order Service
const orderService = {
  async createPendingOrder(productId, quantity, userId) {
    try {
      const order = await Order.create({ 
        productId, 
        quantity, 
        userId,
        status: 'pending'
      });
      return order._id;
    } catch (error) {
      console.error('Pending order creation failed:', error);
      return null;
    }
  },

  async confirmOrder(orderId) {
    await Order.updateOne({ _id: orderId }, { status: 'confirmed' });
  },

  async cancelOrder(orderId) {
    await Order.updateOne({ _id: orderId }, { status: 'cancelled' });
  }
};

// Payment Service (simplified)
const paymentService = {
  async processPayment(orderId, amount) {
    // Simulate payment processing
    const success = Math.random() > 0.1; // 90% success rate
    return { success, transactionId: success ? 'txn_' + Date.now() : null };
  }
};

// Orchestrator Service (implementing Saga pattern)
async function createOrder(productId, quantity, userId) {
  // Step 1: Reserve stock
  const stockReserved = await productService.reserveStock(productId, quantity);
  if (!stockReserved) {
    return { success: false, message: 'Failed to reserve stock' };
  }

  // Step 2: Create pending order
  const orderId = await orderService.createPendingOrder(productId, quantity, userId);
  if (!orderId) {
    await productService.releaseReservedStock(productId, quantity);
    return { success: false, message: 'Failed to create pending order' };
  }

  // Step 3: Process payment
  const { success: paymentSuccess, transactionId } = await paymentService.processPayment(orderId, quantity * 100); // Assume $1 per item
  if (!paymentSuccess) {
    await orderService.cancelOrder(orderId);
    await productService.releaseReservedStock(productId, quantity);
    return { success: false, message: 'Payment failed' };
  }

  // Step 4: Confirm order and update stock
  try {
    await orderService.confirmOrder(orderId);
    await productService.confirmStockReduction(productId, quantity);
    return { 
      success: true, 
      message: 'Order processed successfully', 
      orderId, 
      transactionId 
    };
  } catch (error) {
    // If confirmation fails, we need a compensating transaction
    // This part would typically be handled by a separate process to ensure eventual consistency
    console.error('Order confirmation failed, initiating compensating transaction:', error);
    await paymentService.refundPayment(transactionId);
    await orderService.cancelOrder(orderId);
    await productService.releaseReservedStock(productId, quantity);
    return { success: false, message: 'Order confirmation failed', error: error.message };
  }
}

// Usage
createOrder('product123', 5, 'user456')
  .then(result => console.log(result))
  .catch(error => console.error('Order processing failed:', error));
```  

**Key Points:**

- **Step 1: Reserve Stock**
  - Calls `productService.reserveStock`.
  - If fails, returns an error to the client.
- **Step 2: Create Pending Order**
  - Calls `orderService.createPendingOrder`.
  - If fails, releases reserved stock.
- **Step 3: Process Payment**
  - Calls `paymentService.processPayment`.
  - If fails, cancels the order and releases reserved stock.
- **Step 4: Confirm Order and Update Stock**
  - Calls `orderService.confirmOrder` and `productService.confirmStockReduction`.
  - If fails, initiates compensating transactions:
    - Calls `paymentService.refundPayment`.
    - Cancels the order.
    - Releases reserved stock.

### Usage Example

```javascript
// Usage
createOrder('product123', 5, 'user456')
  .then(result => console.log(result))
  .catch(error => console.error('Order processing failed:', error.message));
```



## Additional Considerations

### Transactions and Data Consistency

- **Limitations of Distributed Transactions**: Traditional ACID transactions don't span multiple microservices. The Saga Pattern helps manage this by ensuring eventual consistency.
- **Eventual Consistency**: Accept that data may be temporarily inconsistent. Design services to handle such inconsistencies gracefully.


### Handling Idempotency

Implement idempotency keys or checks to handle retry scenarios, ensuring that repeated requests do not lead to inconsistent data.

### Asynchronous Communication

Consider using message queues or event buses for communication between services to improve decoupling and scalability.

### Addressing the Orchestrator as a Potential Bottleneck

- **Scalability**: Design the orchestrator to be stateless and scalable horizontally.
- **High Availability**: Implement failover mechanisms to prevent the orchestrator from becoming a single point of failure.
- **Distributed Orchestration**: Explore distributed orchestrators or move towards a choreography-based Saga if appropriate.

### Monitoring and Logging

Implement robust monitoring and logging to track the flow of transactions and quickly identify and resolve issues.



## More Examples

### Food Delivery 

```mermaid
graph TD
    Start["Start Food Delivery Order"]
    ValidateOrder["Validate Order and Restaurant Availability\n(Order Service)"]
    ProcessPayment["Process Payment\n(Payment Service)"]
    ConfirmOrder["Confirm Order with Restaurant\n(Restaurant Service)"]
    AssignDelivery["Assign Delivery Partner\n(Delivery Service)"]
    NotifyCustomer["Notify Customer\n(Notification Service)"]
    TrackDelivery["Track Delivery\n(Delivery Service)"]
    CompleteOrder["Complete Order\n(Order Service)"]
    OrderSuccess["Order Delivered Successfully"]
    OrderFailure["Order Failed"]

    Start --> ValidateOrder
    ValidateOrder -->|Success| ProcessPayment
    ValidateOrder -->|Failure| OrderFailure
    ProcessPayment -->|Success| ConfirmOrder
    ProcessPayment -->|Failure| RefundPayment["Refund Payment\n(Payment Service)"] --> OrderFailure
    ConfirmOrder -->|Success| AssignDelivery
    ConfirmOrder -->|Failure| CancelPayment["Cancel and Refund Payment\n(Payment Service)"] --> OrderFailure
    AssignDelivery -->|Success| NotifyCustomer
    AssignDelivery -->|Failure| CancelRestaurantOrder["Cancel Restaurant Order\n(Restaurant Service)"] --> CancelAndRefundPayment["Cancel and Refund Payment\n(Payment Service)"] --> OrderFailure
    NotifyCustomer --> TrackDelivery
    TrackDelivery -->|Delivered| CompleteOrder
    TrackDelivery -->|Delivery Failed| ReassignDelivery["Reassign Delivery Partner\n(Delivery Service)"]
    ReassignDelivery -->|Success| TrackDelivery
    ReassignDelivery -->|Failure| CancelDelivery["Cancel Delivery\n(Delivery Service)"] --> CancelRestaurantOrderAfterDeliveryFailure["Cancel Restaurant Order\n(Restaurant Service)"] --> RefundPaymentAfterDeliveryFailure["Refund Payment\n(Payment Service)"] --> OrderFailure
    CompleteOrder --> OrderSuccess

    style OrderSuccess fill:#e6ffe6,stroke:#66cc66
    style OrderFailure fill:#ffe6e6,stroke:#ff6666

```


## Conclusion

By enhancing the implementation of the Saga Pattern and incorporating a Payment Service, we've created a more robust and realistic microservices architecture that handles distributed transactions effectively. This approach ensures data consistency across services, improves error handling, and aligns with the principles of scalable and resilient microservices design.

## Q&A

### What is the primary challenge in maintaining data consistency across microservices in a distributed system?

The primary challenge is ensuring that operations across different services are consistent when one operation could fail while others succeed.

### What does 'eventual consistency' mean in the context of the Saga Pattern and distributed systems?

Eventual consistency means that data may be temporarily out of sync across different services during a transaction. However, the system ensures that all data will eventually become consistent, either by completing all steps successfully or by undoing partial changes.


### Differentiate between the two types of Saga implementations: Orchestration-Based Saga and Choreography-Based Saga.

Orchestration-Based Saga uses a central coordinator (orchestrator) to manage the transaction steps and compensating actions across services. It provides centralized control and visibility but can become a single point of failure. Choreography-Based Saga, in contrast, distributes responsibility among participating services, with each service publishing events that trigger the next action. This approach is more decentralized and loosely coupled, but can be harder to track and debug. The choice between them depends on the complexity of the transaction and the desired level of centralization in the system architecture.


### Any alternatives to the Saga Pattern for managing distributed transactions in microservices?




